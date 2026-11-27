import "./site.css";
import type { AppId, InboxItem } from "../../../shared/contract";
import { MENU, pageFor, type PageModel } from "../../glasses/src/display";
import {
  adoptInbox, applyAsk, applyEdit, applyHealth, applyTask, applyVoice, askFailed, beginAsk,
  beginAskLoading, beginTask, beginTaskTranscribing, cancelCountdown, cancelTask, chooseOption,
  clearFlash, clearNotes, countdownDue, countdownLeft, deckFailed, doubleTap, draftFor, endRecording,
  finishSend, focusedPoint, initialState, isCatchUp, markLoading, markOffline, markSending, moveFocus,
  noteFor, openDeck, press, receiptDue, recordingFailed, recordingTickDelay, routineGroupFocused,
  sendFailed, setFlash, setInboxFocus, setPersona, shouldAcceptSwipe, showReceipt, startCountdown,
  startInboxCountdown, startMarkSeen, startReview, taskDue, taskFailed, taskHeard, wearChanged,
  RECEIPT_HOLD_MS, TASK_HOLD_MS, type Effect, type SamplePersona, type State,
} from "../../glasses/src/model";
import { composeReview } from "../../glasses/src/mock";
import { applyEdit as editGrammar } from "../../../shared/edit";
import { WebApi } from "./sim/api";
import { LensPainter } from "./scene/display";
import { RingController, type Gesture } from "./sim/gestures";
import { MicRecorder } from "./sim/mic";
import { Hand } from "./pov/hand";
import {
  destinationFor, renderReceipt, sampleReply, sampleResult, tallyLine, type Sent, type SentReview,
} from "./pov/receipt";
import type { Hero } from "./scene/hero";

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const el = {
  site: $("#site"),
  hero: $(".hero"),
  heroCanvas: $("#hero-canvas") as HTMLCanvasElement,
  wear: $("#wear-button") as HTMLButtonElement,
  watch: $("#watch-link") as HTMLAnchorElement,
  film: $("#film"),
  filmPlay: $("#film-play") as HTMLButtonElement,
  video: $("#demo-video") as HTMLVideoElement,
  pov: $("#pov"),
  takeOff: $("#take-off") as HTMLButtonElement,
  skipGuide: $("#skip-guide") as HTMLButtonElement,
  guideText: $("#guide-text"),
  lensCanvas: $("#lens-canvas") as HTMLCanvasElement,
  lensStatus: $("#lens-status"),
  persona: $("div.persona"),
  typeToggle: $("#type-toggle") as HTMLButtonElement,
  typeForm: $("#type-form") as HTMLFormElement,
  typeInput: $("#type-input") as HTMLInputElement,
  typeStatus: $("#type-status"),
  ring: $("#ring") as HTMLButtonElement,
  ringHint: $("#ring-hint"),
  hand: $("#hand"),
  handCap: $("#hand-cap"),
  toast: $("#toast"),
  toastText: $("#toast-text"),
  seeReceipt: $("#see-receipt") as HTMLButtonElement,
  toastClose: $("#toast-close") as HTMLButtonElement,
  holdMenu: $("#hold-menu"),
  povStatus: $("#pov-status"),
  receipt: $("#receipt-dialog") as HTMLDialogElement,
  receiptWhere: $("#receipt-where"),
  receiptTitle: $("#receipt-title"),
  receiptBody: $("#receipt-body"),
  receiptFoot: $("#receipt-foot"),
  receiptClose: $("#receipt-close") as HTMLButtonElement,
};

type Purpose = "note" | "ask" | "task";

const params = new URLSearchParams(location.search);
const posterMode = params.has("poster");
const painter = new LensPainter(el.lensCanvas);
const hand = new Hand(el.hand, el.handCap);
const recorder = new MicRecorder();

let persona: SamplePersona = params.get("persona") === "everyday" ? "everyday" : "developer";
let api = new WebApi(persona);
let state: State = initialState({ demo: false, loading: true, cloud: false });
state = { ...state, persona };

let hero: Hero | null = null;
let povOpen = false;
let flewIn = false;
let guideOn = true;
let heroPossible = true;
let inboxLoaded = false;
let sceneSettled = false;
let sendInFlight = false;
let transcribing = false;
let recordToken = 0;
let typePurpose: Purpose = "note";
let menuIndex = 0;
let menuEntries: Array<{ id: number; label: string }> = [];
let lastSpoken = "";
let lastSwipeAt = Number.NEGATIVE_INFINITY;
let lastDoubleAt = 0;
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let resultTimer: ReturnType<typeof setTimeout> | undefined;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let ringHintSeen = false;
let sent: Sent | null = null;
let usedHold = false;

const tallies = new Map<string, { taps: number; sentences: number }>();
const completed = new Set<string>();
let taskTally = { taps: 0, sentences: 0 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ---------------- tallies, toast ---------------- */

function tally(threadId: string | undefined): { taps: number; sentences: number } | null {
  if (!threadId) return null;
  let entry = tallies.get(threadId);
  if (!entry) {
    entry = { taps: 0, sentences: 0 };
    tallies.set(threadId, entry);
  }
  return entry;
}

function currentThreadId(): string | undefined {
  return state.deck?.threadId ?? state.pendingSend?.threadId ?? state.reviewThreadId ?? undefined;
}

function announce(text: string): void {
  el.povStatus.textContent = text;
}

function showToast(): void {
  if (!sent || !povOpen) return;
  const line = tallyLine(sent);
  const verb = sent.kind === "task" ? `Started in ${sent.agent}` : `Sent to ${sent.destination}`;
  el.toastText.textContent = line ? `${verb} · ${line}` : verb;
  el.toast.hidden = false;
}

function hideToast(): void {
  el.toast.hidden = true;
}

/* ---------------- guide: one line at a time ---------------- */

const FIRST_REVIEW: Record<string, string> = {
  "login-fix": "Step 4 would sign out every customer. Tap, then say what to change.",
  "payment-upgrade": "The agent is asking one question. Tap to see the answers.",
  "launch-post": "This line promises everyone today. Tap, then say what it should say.",
  "draft-priya": "It says net-60; your contract says net-45. Tap, then say the fix.",
  "saturday-plan": "A picnic at 9°C and windy. Tap, then say what to change.",
  "landlord-reply": "It accepts 5%; you agreed 3% on the phone. Tap, then say the fix.",
  "school-newsletter": "It says Friday the 12th; the plan says Saturday the 13th. Tap, then say the fix.",
};

function guideFor(): string {
  if (!guideOn || state.loading) return "";
  if (state.offline) return "The sample is unavailable. Tap to try again.";
  if (transcribing) return "Turning that into words…";
  if (state.recordingStartedAt !== null) {
    if (state.task?.phase === "recording") return "Say what to start, then tap.";
    if (state.asking) return "Ask your question, then tap.";
    return "Say what to change, then tap. Say nothing and it counts as agreed.";
  }
  switch (state.screen) {
    case "inbox": {
      if (state.workspace === "sample" && usedHold === false && completed.size > 0) {
        return "Hold the ring for Ask, New task and more.";
      }
      const item = state.inbox[state.inboxFocus];
      if (!item) return "All clear. Take them off, or hold the ring for more.";
      if (state.welcome) return "You just put them on: your status, and what changed since you looked.";
      if (item.kind === "catch-up") return "Tap to read what changed while you were away.";
      return completed.size === 0
        ? `Tap ${item.title} — ${item.summary.toLowerCase() || "it needs you"}.`
        : `Tap ${item.title}, or scroll to another.`;
    }
    case "task": {
      const phase = state.task?.phase;
      if (phase === "confirm") return "Tap to start it.";
      if (phase === "started") return "Handed off. It will show up when it needs you.";
      return "";
    }
    case "countdown":
      return state.sending ? "Sending…" : `Sending in ${countdownLeft(state, Date.now())}. Tap to undo.`;
    case "receipt":
      return "Sent.";
    case "options":
      return "Scroll to an answer, then tap. The recommended one is first.";
    case "preview":
      return "";
    default:
      break;
  }
  if (state.deckError) return "Could not load it. Tap to try again.";
  if (!state.deck) return "Opening…";
  if (state.askLoading) return "Looking for the exact sentence…";
  if (state.ask) return state.ask.pointId ? "Tap to jump to that line." : "Double-tap to go back.";
  if (isCatchUp(state)) return "Scroll through the updates. Tap an agent’s line to open it.";
  if (routineGroupFocused(state)) return "The rest is routine and already agreed. Scroll to what needs you.";
  const point = focusedPoint(state);
  if (!point) return "Tap Send. You have 5 seconds to undo.";
  if (noteFor(state, point.id)) return "Scroll down to Send, then tap.";
  if (point.kind === "question") return "Tap to choose an answer.";
  const id = currentThreadId() ?? "";
  if (point.flag || point.risk === "high") return FIRST_REVIEW[id] ?? `${point.glance}. Tap, then say what to change.`;
  return "Scroll to the line marked CHECK.";
}

function updateGuide(): void {
  const text = guideFor();
  el.guideText.textContent = text;
  el.guideText.classList.toggle("is-empty", text.length === 0);
  el.skipGuide.textContent = guideOn ? "Skip guide" : "Show guide";
}

/* ---------------- painting ---------------- */

function spokenPage(page: PageModel): string {
  const rows = page.rows.map((row) =>
    row.text.replace(/^>\s*/, "Selected: ").replace(/\s{2,}/g, " — ").trim());
  const list = (page.list ?? []).map((row, index) => (index === page.listFocus ? `Selected: ${row}` : row));
  return [page.title, page.subtitle, ...list, ...rows, page.pane ?? page.message ?? "", page.footer]
    .filter(Boolean).join(". ");
}

function render(): void {
  const page = pageFor(state, Date.now());
  painter.draw(page);
  hero?.setDisplay();
  const spoken = spokenPage(page);
  if (spoken !== lastSpoken) {
    lastSpoken = spoken;
    el.lensStatus.textContent = spoken;
  }
  updateType();
  updateGuide();
  scheduleClock();
}

function scheduleClock(): void {
  clearTimeout(clockTimer);
  const now = Date.now();
  if (state.recordingStartedAt !== null) {
    const delay = recordingTickDelay(now, state.recordingStartedAt);
    if (delay <= 0) {
      void stopRecording();
      return;
    }
    clockTimer = setTimeout(render, Math.max(80, delay));
    return;
  }
  if (state.screen === "countdown" && state.countdownStartedAt !== null) {
    if (countdownDue(state, now)) {
      if (!state.sending) void sendReview();
      else clockTimer = setTimeout(render, 250);
      return;
    }
    clockTimer = setTimeout(render, Math.max(60, 1_000 - ((now - state.countdownStartedAt) % 1_000) + 30));
    return;
  }
  if (state.screen === "task" && state.task?.phase === "started" && state.task.startedAt !== undefined) {
    if (taskDue(state, now)) {
      finishTask();
      return;
    }
    clockTimer = setTimeout(finishTask, state.task.startedAt + TASK_HOLD_MS - now);
    return;
  }
  if (state.screen === "receipt" && state.receiptAt !== null) {
    if (receiptDue(state, now)) {
      finishSent();
      return;
    }
    clockTimer = setTimeout(finishSent, Math.max(40, state.receiptAt + RECEIPT_HOLD_MS - now));
    return;
  }
  if (state.flash) {
    if (state.flash.until <= now) {
      state = clearFlash(state);
      render();
      return;
    }
    clockTimer = setTimeout(render, state.flash.until - now);
  }
}

/* ---------------- inbox + navigation ---------------- */

async function loadInbox(showLoading: boolean): Promise<void> {
  const source = api;
  try {
    if (showLoading) {
      state = markLoading(state);
      render();
    }
    const [inbox, health] = await Promise.all([source.inbox(), source.health()]);
    if (source !== api) return;
    state = adoptInbox(state, inbox.items, { demo: false, offline: false, status: inbox.status ?? null });
    state = applyHealth(state, health);
  } catch {
    if (source !== api) return;
    state = markOffline(state, "Sample unavailable. Tap to retry.");
  }
  render();
}

async function openThreadItem(item: InboxItem): Promise<void> {
  tally(item.threadId);
  state = startReview(state, item);
  closeMenu();
  render();
  try {
    const deck = await api.deck(item.threadId);
    if (state.loadingThreadId !== item.threadId) return;
    if ("pending" in deck) throw new Error("pending");
    state = openDeck(state, deck);
    persistSoon();
    render();
  } catch {
    if (state.loadingThreadId !== item.threadId) return;
    state = deckFailed(state, "Could not load points. Tap to retry.", Date.now());
    render();
  }
}

async function retryDeck(): Promise<void> {
  const threadId = state.reviewThreadId;
  const item = state.inbox.find((entry) => entry.threadId === threadId);
  if (item) await openThreadItem(item);
}

function persistSoon(): void {
  const draft = draftFor(state, Date.now());
  if (!draft) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api.putReview(draft).catch(() => undefined);
  }, 200);
}

/* ---------------- gestures ---------------- */

async function handleGesture(gesture: Gesture): Promise<void> {
  if (!povOpen) return;
  if (!ringHintSeen) {
    ringHintSeen = true;
    el.ringHint.classList.add("is-gone");
  }
  hand.play(gesture);
  announce({ up: "Scrolled up", down: "Scrolled down", tap: "Tap", double: "Double-tap", hold: "Hold" }[gesture]);

  if (menuOpen()) {
    menuGesture(gesture);
    return;
  }
  if (gesture === "hold") {
    openMenu();
    return;
  }
  if (gesture === "up" || gesture === "down") {
    const now = performance.now();
    if (!shouldAcceptSwipe(now, lastSwipeAt)) return;
    lastSwipeAt = now;
    const before = state;
    state = moveFocus(state, gesture === "up" ? -1 : 1);
    if (before.notes !== state.notes || before.seen !== state.seen) persistSoon();
    render();
    return;
  }
  if (gesture === "double") {
    const now = performance.now();
    if (now - lastDoubleAt < 340) return;
    lastDoubleAt = now;
    await dispatch("double");
    return;
  }
  if (state.screen === "inbox") {
    const item = state.inbox[state.inboxFocus];
    if (item && item.kind !== "catch-up") {
      const entry = tally(item.threadId);
      if (entry) entry.taps += 1;
    }
  } else if (state.screen === "task") {
    taskTally.taps += 1;
  } else if (state.screen !== "receipt") {
    const entry = tally(currentThreadId());
    if (entry) entry.taps += 1;
  }
  await dispatch("tap");
}

async function dispatch(kind: "tap" | "double"): Promise<void> {
  const before = state;
  const result = kind === "tap" ? press(state, Date.now()) : doubleTap(state);
  state = result.state;
  if (
    before.recordingStartedAt !== null && state.recordingStartedAt === null
    && result.effect?.type !== "record-stop"
  ) {
    recorder.cancel();
  }
  if (before.notes !== state.notes || before.seen !== state.seen) persistSoon();
  render();
  if (result.effect) await runEffect(result.effect);
}

async function runEffect(effect: Effect): Promise<void> {
  switch (effect.type) {
    case "exit":
      await takeOff();
      break;
    case "open": {
      const item = state.inbox[effect.index];
      if (item) await openThreadItem(item);
      break;
    }
    case "send":
      await sendReview();
      break;
    case "record-start":
      await startRecording();
      break;
    case "record-stop":
      await stopRecording();
      break;
    case "retry":
      await loadInbox(false);
      break;
    case "retry-deck":
      await retryDeck();
      break;
    case "mark-seen":
      await markSeen();
      break;
    case "task-start":
      await startTask();
      break;
    case "record-discard":
      recorder.cancel();
      break;
    case "wear-refresh":
      await loadInbox(true);
      break;
    case "preview":
      break;
  }
}

/* ---------------- voice + typing ---------------- */

recorder.onAutoStop = () => {
  if (state.recordingStartedAt !== null) void stopRecording();
};

function purposeNow(): Purpose {
  if (state.task?.phase === "recording" || state.task?.phase === "transcribing") return "task";
  if (state.asking || state.askLoading) return "ask";
  return "note";
}

async function startRecording(): Promise<void> {
  if (state.recordingStartedAt === null) return;
  closeType();
  try {
    // A permission prompt nobody answers must not leave "Listening" up forever.
    await Promise.race([
      recorder.start(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("mic timeout")), 12_000)),
    ]);
  } catch {
    recorder.cancel();
    if (state.recordingStartedAt === null) return;
    // No microphone here: keep the listening state so a typed sentence goes the same way.
    state = setFlash(state, "No microphone. Type it instead.", Date.now(), 4_000);
    await openType(purposeNow(), "Your browser blocked the microphone. Type it instead.");
    render();
  }
}

/** Stop listening and move the model on to "turning it into words", whatever the purpose. */
function endListening(purpose: Purpose): void {
  if (purpose === "task") state = beginTaskTranscribing(state);
  else if (purpose === "ask") state = beginAskLoading(endRecording(state));
  else state = endRecording(state);
}

async function stopRecording(): Promise<void> {
  if (state.recordingStartedAt === null) return;
  const purpose = purposeNow();
  const threadId = state.deck?.threadId;
  const token = ++recordToken;
  endListening(purpose);
  transcribing = true;
  if (purpose === "note") state = setFlash(state, "Working...", Date.now(), 60_000);
  render();
  const pcm = await recorder.stop();
  if (token !== recordToken) return;
  try {
    const result = await api.voice(pcm, threadId ? { threadId } : undefined, purpose);
    if (token !== recordToken) return;
    transcribing = false;
    await takeWords(purpose, result.text, result.verdict);
  } catch {
    if (token !== recordToken) return;
    transcribing = false;
    voiceFailed(purpose);
  }
}

function voiceFailed(purpose: Purpose): void {
  const message = "Couldn't hear that. Type it instead.";
  if (purpose === "task") state = taskFailed(state, message);
  else if (purpose === "ask") state = askFailed(state, message, Date.now());
  else state = setFlash(state, message, Date.now(), 5_000);
  render();
  void openType(purpose, "Couldn't transcribe that. Type it and it goes the same way.");
}

/** The words are in (spoken or typed): same path either way. */
async function takeWords(purpose: Purpose, text: string, verdict?: "object" | "note"): Promise<void> {
  if (purpose === "task") {
    if (state.task?.phase !== "transcribing") return;
    state = taskHeard(state, text, Date.now());
    taskTally.sentences += 1;
    closeType();
    render();
    return;
  }
  const threadId = state.deck?.threadId;
  if (purpose === "ask") {
    await answerQuestion(threadId, text);
    return;
  }
  const beforeNotes = state.notes;
  if (state.screen === "options") {
    const point = focusedPoint(state);
    const index = point?.options?.findIndex((option) => option === text) ?? -1;
    state = index >= 0 ? chooseOption(state, index, Date.now()) : applyVoice({ ...state, screen: "review" }, text, Date.now(), verdict);
  } else {
    state = applyVoice(state, text, Date.now(), verdict);
  }
  if (state.notes !== beforeNotes) {
    const entry = tally(threadId);
    if (entry) entry.sentences += 1;
  }
  persistSoon();
  closeType();
  render();
  if (state.pendingEdit) await applyPendingEdit();
}

async function answerQuestion(threadId: string | undefined, question: string): Promise<void> {
  if (!state.askLoading || !threadId || state.deck?.threadId !== threadId) return;
  try {
    const result = await api.ask(threadId, question);
    if (!state.askLoading) return;
    state = applyAsk(state, question, result);
  } catch {
    if (!state.askLoading) return;
    state = askFailed(state, "Ask failed. Try again.", Date.now());
  }
  closeType();
  render();
}

async function applyPendingEdit(): Promise<void> {
  const pending = state.pendingEdit;
  if (!pending) return;
  const before = state;
  try {
    state = applyEdit(state, await api.edit(pending.threadId, pending.pointId, pending.text));
  } catch {
    state = applyEdit(state, { ok: false, pointId: pending.pointId, before: "", error: "Couldn't change this line" });
  }
  if (before.notes !== state.notes) persistSoon();
  render();
}

/**
 * A spoken correction the shared edit grammar can actually apply to this sentence. The sample's own
 * suggestion is used when it works; otherwise one is made from the line and the evidence behind it
 * ("5%" in the draft, "3%" in your notes -> "3%, not 5%").
 */
function workingEdit(quote: string, why: string | undefined, suggestion: string): string {
  if (editGrammar(quote, suggestion).ok) return suggestion;
  const figure = /\$?\d[\d,.]*(?:%|k|m)?/gi;
  const have: string[] = quote.match(figure) ?? [];
  const want: string[] = (why ?? "").match(figure) ?? [];
  const wanted = want.find((value) => !have.includes(value));
  const wrong = have.find((value) => !want.includes(value));
  if (wanted && wrong) {
    const attempt = `${wanted}, not ${wrong}`;
    if (editGrammar(quote, attempt).ok) return attempt;
  }
  return suggestion;
}

function typeContext(): Purpose | null {
  if (transcribing) return null;
  if (state.recordingStartedAt !== null) return purposeNow();
  if (state.screen === "task" && (state.task?.phase === "error")) return "task";
  if ((state.screen === "review" || state.screen === "options") && state.deck && !state.askLoading) {
    return focusedPoint(state) ? "note" : null;
  }
  return null;
}

function updateType(): void {
  const can = typeContext() !== null;
  const open = !el.typeForm.hidden;
  el.typeToggle.hidden = !can || open;
  if (!can && open) closeType();
}

async function openType(purpose: Purpose, status = ""): Promise<void> {
  typePurpose = purpose;
  el.typeForm.hidden = false;
  el.typeToggle.hidden = true;
  el.typeStatus.textContent = status;
  const threadId = state.deck?.threadId;
  const point = focusedPoint(state);
  try {
    const suggestion = await api.suggest(threadId ? { threadId, ...(point ? { pointId: point.id } : {}) } : undefined, purpose);
    el.typeInput.placeholder = purpose === "ask" ? "Ask about this…" : purpose === "task" ? "What should I start?" : "Say what to change…";
    el.typeInput.value = purpose === "note" && point?.kind === "draft"
      ? workingEdit(point.quote, point.why, suggestion)
      : suggestion;
    el.typeInput.select();
  } catch {
    el.typeInput.value = "";
  }
  el.typeInput.focus();
}

function closeType(): void {
  if (el.typeForm.hidden) return;
  el.typeForm.hidden = true;
  el.typeStatus.textContent = "";
  el.typeInput.value = "";
  updateType();
}

async function submitTyped(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text) return;
  const purpose = typePurpose;
  recordToken++;
  recorder.cancel();
  if (purpose === "task") {
    if (state.task?.phase === "error" || state.screen !== "task") {
      state = cancelTask(state);
      state = beginTask(state, Date.now());
    }
    endListening("task");
  } else if (purpose === "ask") {
    if (state.recordingStartedAt === null && !state.askLoading) state = beginAsk(state, Date.now());
    endListening("ask");
  } else if (state.recordingStartedAt !== null) {
    endListening("note");
  }
  transcribing = false;
  render();
  await takeWords(purpose, text);
}

/* ---------------- send, mark seen, new task ---------------- */

function snapshotReview(threadId: string): void {
  const item = state.inbox.find((entry) => entry.threadId === threadId);
  const deck = state.deck?.threadId === threadId ? state.deck : null;
  const points = deck?.points ?? [];
  const app: AppId = item?.app ?? state.pendingSend?.app ?? state.reviewApp ?? "t3";
  const notes = state.notes.map((note) => {
    const point = points.find((entry) => entry.id === note.pointId);
    return {
      quote: point?.quote ?? "",
      text: note.text ?? note.option ?? "",
      ...(note.after !== undefined ? { after: note.after } : {}),
      verdict: note.verdict,
    };
  });
  const recipient = /\bto\s+([^:,·]+)/i.exec(item?.title ?? "")?.[1]?.trim();
  const entry = tallies.get(threadId);
  const review: SentReview = {
    kind: "review",
    threadId,
    app,
    title: item?.title ?? threadId,
    destination: destinationFor(app, recipient),
    review: deck ? composeReview(deck, state.notes).message : "",
    notes,
    taps: entry?.taps ?? 0,
    sentences: entry?.sentences ?? 0,
  };
  sent = review;
  if (app === "t3") {
    window.setTimeout(() => {
      if (sent !== review) return;
      review.reply = sampleReply(review);
      if (el.receipt.open) renderCard();
      announce("The agent replied.");
    }, 3_200);
  }
}

async function sendReview(): Promise<void> {
  const threadId = state.deck?.threadId ?? state.pendingSend?.threadId;
  if (!threadId || sendInFlight || state.sending) return;
  clearTimeout(saveTimer);
  snapshotReview(threadId);
  state = markSending(state);
  render();
  sendInFlight = true;
  try {
    const draft = draftFor(state, Date.now());
    if (draft) await api.putReview(draft);
    const result = await api.send(threadId);
    if (!result.ok) {
      state = sendFailed(state, "Send failed. Try again.", Date.now());
      render();
      return;
    }
    completed.add(threadId);
    state = showReceipt(state, result, Date.now());
    render();
  } catch {
    state = sendFailed(state, "Send failed. Try again.", Date.now());
    render();
  } finally {
    sendInFlight = false;
  }
}

function finishSent(): void {
  if (state.screen !== "receipt") return;
  clearTimeout(saveTimer);
  state = finishSend(state);
  render();
  void loadInbox(true);
  showToast();
}

async function markSeen(threadId = state.deck?.threadId ?? state.pendingSend?.threadId): Promise<void> {
  if (!threadId || sendInFlight) return;
  sendInFlight = true;
  try {
    const result = await api.send(threadId);
    if (!result.ok) {
      state = sendFailed({ ...state, pendingSend: null }, "Couldn't mark seen. Try again.", Date.now());
    } else {
      state = setFlash(finishSend(state), "Marked seen", Date.now(), 2_500);
      void loadInbox(true);
    }
  } catch {
    state = sendFailed({ ...state, pendingSend: null }, "Couldn't mark seen. Try again.", Date.now());
  } finally {
    sendInFlight = false;
  }
  render();
}

async function startTask(): Promise<void> {
  const text = state.task?.text;
  if (!text) return;
  try {
    const result = await api.task(text);
    if (state.task?.phase !== "starting") return;
    state = applyTask(state, result, Date.now());
    if (result.ok) {
      const task: Sent = {
        kind: "task",
        destination: "your agents",
        request: text,
        agent: result.agent ?? "Agent",
        taps: taskTally.taps,
        sentences: Math.max(1, taskTally.sentences),
      };
      sent = task;
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => {
        if (sent !== task) return;
        task.result = sampleResult(text);
        if (el.receipt.open) renderCard();
        announce("The agent finished.");
      }, 4_200);
    }
  } catch {
    state = taskFailed(state, "Couldn't start it. Try again.");
  }
  render();
}

function finishTask(): void {
  if (state.screen !== "task" || state.task?.phase !== "started") return;
  state = cancelTask(state);
  taskTally = { taps: 0, sentences: 0 };
  render();
  void loadInbox(true);
  showToast();
}

/* ---------------- hold menu ---------------- */

const HIDDEN_MENU = new Set<number>([2, 4, 5, MENU.everyday, MENU.developer, MENU.mixed]);

function menuOpen(): boolean {
  return !el.holdMenu.hidden;
}

function paintMenu(): void {
  el.holdMenu.replaceChildren();
  menuEntries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = entry.label;
    button.tabIndex = -1;
    button.classList.toggle("is-on", index === menuIndex);
    button.addEventListener("click", () => {
      closeMenu();
      void handleMenu(entry.id);
    });
    el.holdMenu.append(button);
  });
}

function openMenu(): void {
  usedHold = true;
  const page = pageFor(state, Date.now());
  menuEntries = page.menu.filter((item) => !HIDDEN_MENU.has(item.id));
  if (menuEntries.length === 0) {
    state = setFlash(state, "Nothing in the menu here", Date.now(), 2_000);
    render();
    return;
  }
  menuIndex = 0;
  paintMenu();
  el.holdMenu.hidden = false;
  announce(`Menu: ${menuEntries.map((entry) => entry.label).join(", ")}`);
}

function closeMenu(): void {
  el.holdMenu.hidden = true;
}

function menuGesture(gesture: Gesture): void {
  if (gesture === "up" || gesture === "down") {
    menuIndex = Math.max(0, Math.min(menuEntries.length - 1, menuIndex + (gesture === "down" ? 1 : -1)));
    paintMenu();
    return;
  }
  if (gesture === "tap") {
    const entry = menuEntries[menuIndex];
    closeMenu();
    if (entry) void handleMenu(entry.id);
    return;
  }
  closeMenu();
}

async function handleMenu(id: number): Promise<void> {
  const now = Date.now();
  if (state.screen === "inbox") {
    const item = state.inbox[state.inboxFocus];
    if (id === MENU.agree && item && item.attention !== "question" && item.kind !== "catch-up") {
      tally(item.threadId);
      state = startInboxCountdown(state, item, now);
      render();
    } else if (id === MENU.markSeen && item?.kind === "catch-up") {
      state = startMarkSeen(state, item);
      render();
      await markSeen(item.threadId);
    } else if (id === MENU.newTask) {
      taskTally = { taps: 0, sentences: 0 };
      state = beginTask(state, now);
      if (state.screen !== "task") return;
      render();
      await startRecording();
    }
    return;
  }
  if (isCatchUp(state)) {
    if (id === MENU.markSeen && state.deck && !state.sending) {
      state = { ...state, sending: true };
      render();
      await markSeen();
    }
    return;
  }
  switch (id) {
    case 1:
      if (state.screen === "countdown") state = cancelCountdown(state);
      else if (state.deck) state = startCountdown(state, now);
      render();
      break;
    case 3: {
      const before = state;
      state = clearNotes(state, now);
      if (before.notes !== state.notes) persistSoon();
      render();
      break;
    }
    case MENU.ask:
      if (state.screen !== "review" || !state.deck || state.recordingStartedAt !== null) break;
      state = beginAsk(state, now);
      render();
      await startRecording();
      break;
  }
}

/* ---------------- persona, reset ---------------- */

function resetSession(): void {
  clearTimeout(clockTimer);
  clearTimeout(saveTimer);
  clearTimeout(resultTimer);
  recordToken++;
  recorder.cancel();
  transcribing = false;
  closeType();
  closeMenu();
  hideToast();
  if (el.receipt.open) el.receipt.close();
  tallies.clear();
  completed.clear();
  taskTally = { taps: 0, sentences: 0 };
  sent = null;
  usedHold = false;
  lastSwipeAt = Number.NEGATIVE_INFINITY;
  lastDoubleAt = 0;
  lastSpoken = "";
}

async function choosePersona(next: SamplePersona): Promise<void> {
  if (next === persona || sendInFlight) return;
  persona = next;
  resetSession();
  api = new WebApi(next);
  state = { ...setPersona(state, next), worn: true, workspace: "sample" };
  for (const button of el.persona.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.persona === next));
  }
  render();
  await loadInbox(false);
  state = { ...state, welcome: true };
  render();
  announce(`${next === "developer" ? "Developer" : "Everyday"} inbox`);
}

/* ---------------- receipt card ---------------- */

function renderCard(): void {
  if (!sent) return;
  renderReceipt(
    { where: el.receiptWhere, title: el.receiptTitle, body: el.receiptBody, foot: el.receiptFoot },
    sent,
  );
}

function openReceipt(): void {
  if (!sent) return;
  renderCard();
  if (!el.receipt.open) el.receipt.showModal();
  el.receiptClose.focus();
}

/* ---------------- hero + through the glasses ---------------- */

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return gl !== null;
  } catch {
    return false;
  }
}

function lowPower(): boolean {
  const device = navigator as Navigator & { deviceMemory?: number };
  return (device.hardwareConcurrency ?? 8) <= 2 || (device.deviceMemory ?? 8) <= 2;
}

function markReady(): void {
  if (!inboxLoaded || !sceneSettled) return;
  (window as Window & { __pinpointReady?: boolean }).__pinpointReady = true;
}

function loadHero(): void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!heroPossible || reduced || lowPower() || !webglAvailable()) {
    sceneSettled = true;
    markReady();
    return;
  }
  const start = () => {
    void import("./scene/hero")
      .then(({ createHero }) =>
        createHero({
          canvas: el.heroCanvas,
          display: el.lensCanvas,
          still: posterMode,
          onReady: () => {
            sceneSettled = true;
            el.hero.classList.add("is-live");
            // Once the live scene has faded in, the still behind it is not needed any more.
            window.setTimeout(() => el.hero.classList.add("is-settled"), 1_400);
            markReady();
          },
        }))
      .then((instance) => {
        hero = instance;
        instance.setDisplay();
        if (povOpen) instance.pause();
      })
      .catch(() => {
        sceneSettled = true;
        markReady();
      });
  };
  const idle = window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number };
  if (typeof idle.requestIdleCallback === "function") idle.requestIdleCallback(start, { timeout: 1_400 });
  else setTimeout(start, 900);
}

/** The wear sensor, as the browser sees it: the same event the glasses app reacts to. */
async function applyWear(worn: boolean): Promise<void> {
  api.simulateWear(worn);
  const result = wearChanged(state, worn);
  state = result.state;
  render();
  if (result.effect) await runEffect(result.effect);
}

async function putOn(): Promise<void> {
  if (povOpen) return;
  povOpen = true;
  closeType();
  hideToast();
  closeMenu();
  guideOn = true;
  const fly = hero?.flyIn();
  if (fly) {
    await Promise.race([fly.catch(() => undefined), sleep(1_150)]);
    flewIn = true;
  } else {
    await sleep(200);
  }
  el.pov.hidden = false;
  el.pov.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-pov");
  el.site.inert = true;
  hero?.pause();
  render();
  el.ring.focus({ preventScroll: true });
  await applyWear(true);
}

async function takeOff(): Promise<void> {
  if (!povOpen) return;
  recordToken++;
  recorder.cancel();
  transcribing = false;
  if (state.screen === "countdown") state = cancelCountdown(state);
  closeType();
  closeMenu();
  hideToast();
  if (el.receipt.open) el.receipt.close();
  await applyWear(false);
  povOpen = false;
  el.pov.hidden = true;
  el.pov.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-pov");
  el.site.inert = false;
  el.wear.focus({ preventScroll: true });
  hero?.resume();
  if (flewIn) {
    await hero?.flyOut();
    flewIn = false;
  }
}

/* ---------------- setup ---------------- */

new RingController(el.ring, (gesture) => {
  void handleGesture(gesture);
});

el.wear.addEventListener("click", () => void putOn());
el.takeOff.addEventListener("click", () => void takeOff());
el.skipGuide.addEventListener("click", () => {
  guideOn = !guideOn;
  updateGuide();
  announce(guideOn ? "Guide on" : "Guide off");
});
for (const button of el.persona.querySelectorAll<HTMLButtonElement>("button")) {
  button.addEventListener("click", () => {
    el.ring.focus({ preventScroll: true });
    void choosePersona(button.dataset.persona as SamplePersona);
  });
}
for (const trigger of document.querySelectorAll<HTMLElement>("[data-try]")) {
  trigger.addEventListener("click", async () => {
    const wanted = trigger.dataset.try as SamplePersona;
    if (wanted !== persona) await choosePersona(wanted);
    await putOn();
  });
}
el.typeToggle.addEventListener("click", () => void openType(typeContext() ?? "note"));
el.typeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitTyped(el.typeInput.value);
});
el.typeInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeType();
    el.ring.focus();
  }
});
el.toastClose.addEventListener("click", () => {
  hideToast();
  el.ring.focus({ preventScroll: true });
});
el.seeReceipt.addEventListener("click", openReceipt);
el.receiptClose.addEventListener("click", () => el.receipt.close());
el.receipt.addEventListener("close", () => {
  // Back to the ring, so Enter and the arrow keys keep driving the glasses.
  if (povOpen) el.ring.focus({ preventScroll: true });
});

function playFilm(): void {
  void el.video.play()
    .then(() => {
      el.film.classList.add("is-playing");
      el.video.controls = true;
    })
    .catch(() => undefined);
}
el.filmPlay.addEventListener("click", playFilm);
el.video.addEventListener("play", () => {
  el.film.classList.add("is-playing");
  el.video.controls = true;
});
el.video.addEventListener("ended", () => {
  el.film.classList.remove("is-playing");
  el.video.controls = false;
});
el.watch.addEventListener("click", (event) => {
  event.preventDefault();
  el.film.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(playFilm, 450);
});

window.addEventListener("pointerdown", () => recorder.prime(), { once: true, capture: true });
window.addEventListener("keydown", () => recorder.prime(), { once: true, capture: true });

document.addEventListener("click", (event) => {
  if (!menuOpen()) return;
  const target = event.target as Node;
  if (el.holdMenu.contains(target) || el.ring.contains(target)) return;
  closeMenu();
});

window.addEventListener("keydown", (event) => {
  if (!povOpen || el.receipt.open || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
  // Enter belongs to a focused button or link; the other ring keys work from anywhere.
  if (event.key === "Enter" && target?.closest("button, a") && !target.closest("#ring")) return;
  const actions: Record<string, Gesture | undefined> = {
    ArrowUp: "up", ArrowDown: "down", Enter: "tap", Escape: "double", h: "hold", H: "hold",
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  void handleGesture(action);
});

// The panel's drawn type size depends on its rendered width, so redraw when a
// rotated phone (or a resized desktop window) changes the layout.
window.addEventListener("resize", () => {
  if (!povOpen) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => render(), 120);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || state.recordingStartedAt === null) return;
  recordToken++;
  recorder.cancel();
  state = recordingFailed(state, "Recording stopped", Date.now());
  render();
});

if (posterMode) {
  document.body.classList.add("is-poster");
  document.documentElement.classList.add("is-poster");
}

render();
void loadInbox(false).then(() => {
  inboxLoaded = true;
  markReady();
});
if (document.fonts) void document.fonts.ready.then(() => render());
loadHero();
