import "./site.css";
import type { InboxItem, Note } from "../../../shared/contract";
import { pageFor } from "../../glasses/src/display";
import {
  adoptInbox, applyEdit, applyHealth, applyVoice, cancelCountdown, chooseOption, clearFlash, clearNotes,
  countdownDue, countdownLeft, deckFailed, doubleTap, draftFor, endRecording, finishSend, focusedPoint,
  initialState, markLoading, markOffline, markSending, mergeDeck, moveFocus, noteFor, openDeck, press,
  receiptDue, sendFailed, setFlash, shouldAcceptSwipe, showReceipt, startCountdown, startInboxCountdown, startReview,
  RECEIPT_HOLD_MS, VOICE_MAX_MS, type Effect, type State,
} from "../../glasses/src/model";
import { SimBackend, type SimEvent } from "./sim/backend";
import { DATASETS, datasetById, type SimDataset, type SimThread } from "./sim/datasets";
import { G2Lens } from "./sim/lens";
import { RingController, type Gesture } from "./sim/ring";
import { MicRecorder } from "./sim/mic";
import { SidePanels } from "./sim/panels";

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const elements = {
  stage: $("#stage"),
  console: $("#console"),
  guide: $("#guide"),
  guideText: $("#guide-text"),
  guideDismiss: $("#guide-dismiss"),
  playback: $("#playback"),
  playbackStep: $("#playback-step"),
  playbackText: $("#playback-text"),
  playbackStop: $("#playback-stop"),
  playButton: $("#play-button") as HTMLButtonElement,
  playLabel: $("#play-label"),
  resetButton: $("#reset-button") as HTMLButtonElement,
  typeLink: $("#type-link") as HTMLButtonElement,
  fallback: $("#fallback"),
  fallbackTitle: $("#fallback-title"),
  fallbackQuote: $("#fallback-quote"),
  fallbackChips: $("#fallback-chips"),
  fallbackForm: $("#fallback-form") as HTMLFormElement,
  fallbackInput: $("#fallback-input") as HTMLInputElement,
  fallbackStatus: $("#fallback-status"),
  fallbackClose: $("#fallback-close") as HTMLButtonElement,
  gestureToast: $("#gesture-toast"),
  menu: $("#hold-menu"),
  menuItems: $("#hold-menu-items"),
  datasetTabs: $("#dataset-tabs"),
};

const params = new URLSearchParams(location.search);
const requestedDataset = params.get("dataset");
let dataset: SimDataset = requestedDataset
  ? datasetById(requestedDataset)
  : DATASETS.find((entry) => entry.status === "ready") ?? DATASETS[0]!;
if (dataset.status !== "ready") dataset = DATASETS[0]!;

let backend = new SimBackend(dataset);
let unsubscribe = backend.subscribe(handleSimEvent);
let state: State = initialState({ demo: true, loading: true });
const lens = new G2Lens($(".g2-frame"));
const panels = new SidePanels();
const recorder = new MicRecorder();

let panelThreadId: string | null = null;
let panelThread: SimThread | null = null;
let panelIsReply = false;
let panelNotes: Note[] = [];

let clockTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastSwipeAt = Number.NEGATIVE_INFINITY;
let lastDoubleAt = 0;
let lastMenuAt = 0;
let inboxInFlight = false;
let inboxQueued = false;
let sendInFlight = false;
let resetInFlight = false;
let recordToken = 0;
let transcribing = false;
let fallbackOpen = false;
let guideDismissed = false;
let playFinished = false;
let watch: { cancelled: boolean } | null = null;
let focusInputOnFallback = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ---------------- boot + inbox ---------------- */

async function loadInbox(showLoading: boolean): Promise<void> {
  if (inboxInFlight) {
    inboxQueued = true;
    return;
  }
  inboxInFlight = true;
  const source = backend;
  try {
    if (showLoading) {
      state = markLoading(state);
      render();
    }
    const [inbox, health] = await Promise.all([source.inbox(), source.health()]);
    if (source !== backend) return;
    state = adoptInbox(state, inbox.items, { demo: true, offline: false });
    state = applyHealth(state, health);
  } catch {
    if (source !== backend) return;
    state = markOffline(state, "Sample workspace unavailable. Tap to retry.");
  } finally {
    inboxInFlight = false;
    if (source === backend) render();
    if (inboxQueued) {
      inboxQueued = false;
      void loadInbox(false);
    }
  }
}

async function openThread(index: number): Promise<void> {
  const item = state.inbox[index];
  if (!item) return;
  await openThreadItem(item);
}

async function retryDeck(): Promise<void> {
  const threadId = state.reviewThreadId;
  if (!threadId) return;
  const item = state.inbox.find((entry) => entry.threadId === threadId) ?? {
    threadId,
    title: state.reviewTitle || threadId,
    project: "",
    attention: "report",
    summary: "",
    updatedAt: new Date().toISOString(),
    deckReady: false,
    pointCount: 0,
    draftNotes: 0,
  } satisfies InboxItem;
  await openThreadItem(item);
}

async function openThreadItem(item: InboxItem): Promise<void> {
  state = startReview(state, item);
  panelNotes = [];
  panelIsReply = false;
  render();
  try {
    const deck = await backend.deck(item.threadId);
    if (state.loadingThreadId !== item.threadId) return;
    state = openDeck(state, deck);
    persistSoon();
    render();
  } catch {
    if (state.loadingThreadId !== item.threadId) return;
    state = deckFailed(state, "Could not load points. Tap to retry.", Date.now());
    render();
  }
}

/* ---------------- render ---------------- */

function render(): void {
  const now = Date.now();
  const page = pageFor(state, now);
  lens.render(page);
  if (panelThread && state.deck?.threadId === panelThread.threadId && !panelIsReply) {
    panelNotes = state.notes;
  }
  panels.render({
    thread: panelThread,
    isReply: panelIsReply,
    notes: panelNotes,
    history: panelThread ? backend.historyFor(panelThread.threadId) : {},
  });
  updateStage(now);
  scheduleClock();
}

function renderTabs(): void {
  elements.datasetTabs.replaceChildren();
  for (const entry of DATASETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.dataset.dataset = entry.id;
    button.setAttribute("aria-selected", String(entry.id === dataset.id));
    button.disabled = entry.status !== "ready";
    button.title = entry.status === "ready" ? entry.blurb : `${entry.blurb} Coming soon.`;
    const label = document.createElement("span");
    label.textContent = entry.label;
    const note = document.createElement("small");
    note.textContent = entry.status === "ready" ? entry.tabNote : `${entry.tabNote} · soon`;
    button.append(label, note);
    elements.datasetTabs.append(button);
  }
}

function updateStage(now: number): void {
  const demo = dataset.demo;
  const guideText = guideFor(now);
  elements.guide.hidden = !guideText;
  if (guideText) elements.guideText.textContent = guideText;

  const canType = Boolean(
    state.deck && (state.screen === "review" || state.screen === "options")
      && state.recordingStartedAt === null && !transcribing && !watch,
  );
  elements.typeLink.hidden = !canType;
  elements.playButton.disabled = !demo;
  elements.playButton.classList.toggle("is-playing", Boolean(watch));
  elements.playButton.classList.toggle("btn-ghost", Boolean(watch));
  elements.playButton.classList.toggle("btn-primary", !watch);
  if (watch) elements.playLabel.textContent = "Stop playback";
  else if (playFinished) elements.playLabel.textContent = "Watch it again";
  else elements.playLabel.textContent = "Watch it play";

  renderFallback(now);
}

function scheduleClock(): void {
  clearTimeout(clockTimer);
  const now = Date.now();
  if (state.recordingStartedAt !== null) {
    const elapsed = now - state.recordingStartedAt;
    if (elapsed >= VOICE_MAX_MS) {
      void stopRecording();
      return;
    }
    const delay = Math.min(1_000 - (elapsed % 1_000) + 30, VOICE_MAX_MS - elapsed);
    clockTimer = setTimeout(() => render(), Math.max(80, delay));
    return;
  }
  if (state.screen === "countdown" && state.countdownStartedAt !== null) {
    if (countdownDue(state, now)) {
      if (!state.sending) void sendReview();
      else clockTimer = setTimeout(() => render(), 250);
      return;
    }
    const elapsed = now - state.countdownStartedAt;
    clockTimer = setTimeout(() => render(), Math.max(60, 1_000 - (elapsed % 1_000) + 30));
    return;
  }
  if (state.screen === "receipt" && state.receiptAt !== null) {
    if (receiptDue(state, now)) {
      finishSent();
      return;
    }
    clockTimer = setTimeout(finishSent, state.receiptAt + RECEIPT_HOLD_MS - now);
    return;
  }
  if (state.flash) {
    if (state.flash.until <= now) {
      state = clearFlash(state);
      return;
    }
    clockTimer = setTimeout(() => render(), state.flash.until - now);
  }
}

function finishSent(): void {
  if (state.screen !== "receipt") return;
  clearTimeout(saveTimer);
  state = finishSend(state);
  render();
  void loadInbox(true);
}

/* ---------------- input ---------------- */

function showGesture(gesture: Gesture): void {
  const labels: Record<Gesture, string> = {
    up: "Scroll ↑",
    down: "Scroll ↓",
    tap: "Tap",
    double: "Double-tap",
    hold: "Hold · menu",
  };
  elements.gestureToast.textContent = labels[gesture];
  elements.gestureToast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.gestureToast.classList.remove("is-on"), 1_400);
}

async function handleGesture(gesture: Gesture, source: "user" | "script" = "user"): Promise<void> {
  if (source === "user" && watch) stopWatch("Paused — you took over.");
  if (source === "user") showGesture(gesture);
  if (!elements.menu.hidden) {
    closeMenu();
    return;
  }
  if (gesture === "hold") {
    toggleMenu();
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
    if (now - lastDoubleAt < 350) return;
    lastDoubleAt = now;
    await dispatch("double");
    return;
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
      state = setFlash(state, "Exit dialog is shown on the glasses.", Date.now(), 3_000);
      render();
      break;
    case "open":
      await openThread(effect.index);
      break;
    case "preview":
      if (state.deck) {
        state = startCountdown(state, Date.now());
        render();
      }
      break;
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
  }
}

function persistSoon(): void {
  const draft = draftFor(state, Date.now());
  if (!draft) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void backend.putReview(draft).catch(() => undefined);
  }, 200);
}

/* ---------------- recording + transcription ---------------- */

async function startRecording(): Promise<void> {
  if (state.recordingStartedAt === null) return;
  closeFallback();
  if (watch) return; // the scripted run types the note; it never opens the mic
  try {
    await recorder.start();
  } catch {
    if (state.recordingStartedAt === null) return;
    state = endRecording(state);
    state = setFlash(state, "Mic blocked. Pick a line or type it.", Date.now(), 6_000);
    openFallback("Your browser blocked the microphone. Suggestions and typing work the same way.");
    render();
  }
}

async function stopRecording(): Promise<void> {
  if (state.recordingStartedAt === null) return;
  const token = ++recordToken;
  state = endRecording(state);
  transcribing = true;
  render();
  const pcm = await recorder.stop();
  if (token !== recordToken) return;
  if (pcm.length < 6_400) {
    transcribing = false;
    state = setFlash(state, "No speech captured. Type it instead.", Date.now(), 5_000);
    openFallback("That clip was too short. Pick a suggested line or type your own.");
    render();
    return;
  }
  try {
    const result = await backend.voice(pcm);
    if (token !== recordToken) return;
    const before = state;
    state = applyVoice(state, result.text, Date.now(), result.verdict);
    transcribing = false;
    if (before.notes !== state.notes) persistSoon();
    closeFallback();
    render();
    if (state.pendingEdit) await applyPendingEdit();
  } catch {
    if (token !== recordToken) return;
    transcribing = false;
    state = setFlash(state, "Couldn’t transcribe. Pick a line or type it.", Date.now(), 6_000);
    openFallback("Transcription is unavailable right now. Your note still goes through if you type it.");
    render();
  }
}

async function applyTypedNote(text: string): Promise<void> {
  if (state.recordingStartedAt !== null) {
    recorder.cancel();
    state = endRecording(state);
  }
  const now = Date.now();
  if (state.screen === "options") {
    const point = focusedPoint(state);
    const index = point?.options?.findIndex((option) => option === text) ?? -1;
    state = index >= 0 ? chooseOption(state, index, now) : applyVoice({ ...state, screen: "review" }, text, now);
  } else {
    state = applyVoice(state, text, now);
  }
  persistSoon();
  closeFallback();
  render();
  if (state.pendingEdit) await applyPendingEdit();
}

/** A 'draft' sentence is fixed in place; the note stays saved if the edit fails. */
async function applyPendingEdit(): Promise<void> {
  const pending = state.pendingEdit;
  if (!pending) return;
  const before = state;
  try {
    const result = await backend.edit(pending.threadId, pending.pointId, pending.text);
    state = applyEdit(state, result);
  } catch {
    state = applyEdit(state, {
      ok: false,
      pointId: pending.pointId,
      before: "",
      error: "Couldn't change this line",
    });
  }
  if (before.notes !== state.notes) persistSoon();
  render();
}

function submitTypedNote(text: string): void {
  const value = text.trim();
  if (!value) return;
  if (watch) stopWatch("Paused — you took over.");
  void applyTypedNote(value);
}

/* ---------------- voice fallback panel ---------------- */

function openFallback(reason?: string): void {
  fallbackOpen = true;
  focusInputOnFallback = Boolean(reason);
  elements.fallbackStatus.textContent = reason ?? "";
  renderFallback(Date.now());
}

function closeFallback(): void {
  if (!elements.fallback.hidden && elements.fallback.contains(document.activeElement)) {
    const ring = document.querySelector<HTMLElement>("[data-ring]");
    (elements.typeLink.hidden ? ring : elements.typeLink)?.focus();
  }
  fallbackOpen = false;
  renderFallback(Date.now());
}

function renderFallback(now: number): void {
  elements.fallback.hidden = !fallbackOpen;
  if (!fallbackOpen) return;
  const point = focusedPoint(state);
  const options = state.screen === "options" ? point?.options ?? [] : [];
  elements.fallbackTitle.textContent = state.recordingStartedAt !== null
    ? "Recording — or type instead"
    : "Type it instead";
  elements.fallbackQuote.textContent = point
    ? options.length > 0
      ? point.glance
      : `“${point.quote}”`
    : "Open a point first, then your note lands on it.";
  const suggestions = options.length > 0
    ? options
    : panelThreadId
      ? backend.suggestionsFor(panelThreadId, point?.id)
      : [];
  elements.fallbackChips.replaceChildren();
  for (const suggestion of suggestions.slice(0, 4)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = suggestion;
    chip.addEventListener("click", () => submitTypedNote(suggestion));
    elements.fallbackChips.append(chip);
  }
  if (focusInputOnFallback) {
    focusInputOnFallback = false;
    elements.fallbackInput.focus();
  }
  if (elements.fallbackStatus.textContent === "" && !point) {
    elements.fallbackStatus.textContent = "";
  }
  void now;
}

/* ---------------- send ---------------- */

async function sendReview(): Promise<void> {
  const threadId = state.deck?.threadId ?? state.pendingSend?.threadId;
  if (!threadId || sendInFlight || state.sending) return;
  clearTimeout(saveTimer);
  state = markSending(state);
  render();
  sendInFlight = true;
  try {
    const draft = draftFor(state, Date.now());
    if (draft) await backend.putReview(draft);
    const result = await backend.send(threadId);
    if (!result.ok) {
      state = sendFailed(state, "Send failed. Try again.", Date.now());
      render();
      return;
    }
    state = showReceipt(state, result, Date.now());
    render();
  } catch {
    state = sendFailed(state, "Send failed. Try again.", Date.now());
    render();
  } finally {
    sendInFlight = false;
  }
}

/* ---------------- hold menu ---------------- */

function toggleMenu(): void {
  if (!elements.menu.hidden) {
    closeMenu();
    return;
  }
  const now = performance.now();
  if (now - lastMenuAt < 250) return;
  lastMenuAt = now;
  const page = pageFor(state, Date.now());
  elements.menuItems.replaceChildren();
  for (const item of page.menu) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = item.label;
    button.addEventListener("click", () => void handleMenu(item.id));
    elements.menuItems.append(button);
  }
  if (page.menu.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No menu items on this screen.";
    elements.menuItems.append(empty);
  }
  elements.menu.hidden = false;
  elements.menu.querySelector<HTMLButtonElement>("button")?.focus();
}

function closeMenu(): void {
  if (!elements.menu.hidden && elements.menu.contains(document.activeElement)) {
    document.querySelector<HTMLElement>("[data-ring]")?.focus();
  }
  elements.menu.hidden = true;
}

async function handleMenu(id: number): Promise<void> {
  closeMenu();
  if (state.screen === "inbox") {
    if (id === 4) await loadInbox(false);
    if (id === 6) {
      const item = state.inbox[state.inboxFocus];
      if (item && item.attention !== "question") {
        state = startInboxCountdown(state, item, Date.now());
        render();
      }
    }
    return;
  }
  switch (id) {
    case 1:
      if (state.screen === "countdown") state = cancelCountdown(state);
      else if (state.deck) state = startCountdown(state, Date.now());
      render();
      break;
    case 2:
      state = setFlash(state, "The phone link lives on the real device.", Date.now(), 4_000);
      render();
      break;
    case 3: {
      const before = state;
      state = clearNotes(state, Date.now());
      if (before.notes !== state.notes) persistSoon();
      render();
      break;
    }
    case 4:
      await refreshCurrent();
      break;
    case 5:
      await resetSim();
      break;
  }
}

async function refreshCurrent(): Promise<void> {
  const deck = state.deck;
  if (!deck) {
    await retryDeck();
    return;
  }
  try {
    const fresh = await backend.deck(deck.threadId);
    if (state.deck?.threadId === deck.threadId) {
      state = mergeDeck(state, fresh);
      state = setFlash(state, "Refreshed", Date.now(), 2_000);
      render();
    }
  } catch {
    state = setFlash(state, "Refresh failed", Date.now(), 3_000);
    render();
  }
}

/* ---------------- guided hints + watch mode ---------------- */

function guideFor(now: number): string {
  if (transcribing) return "Transcribing on the Pinpoint server…";
  if (state.recordingStartedAt !== null) return "Recording. Tap the ring again to stop, or type below.";
  if (state.loading) return "Opening your sample workspace…";
  if (watch || playFinished || guideDismissed) return "";
  const demo = dataset.demo;
  if (!demo) return "";
  if (backend.historyFor(demo.threadId).reply) return "";
  if (state.screen === "inbox") {
    const index = state.inbox.findIndex((item) => item.threadId === demo.threadId);
    if (index < 0) return "";
    if (index === state.inboxFocus) return "Tap to open login-fix — the plan with the risky step.";
    return "Scroll to login-fix, the seven-step plan. Tap to open it.";
  }
  const active = state.deck?.threadId ?? state.pendingSend?.threadId ?? state.reviewThreadId;
  if (active !== demo.threadId) return "";
  if (state.screen === "countdown") {
    return `Sending in ${countdownLeft(state, now)}. Tap the ring to undo, or wait.`;
  }
  if (state.screen === "receipt") return "Sent. The inbox returns by itself in a moment.";
  if (!state.deck) return "";
  const pointIndex = state.deck.points.findIndex((point) => point.id === demo.pointId);
  if (pointIndex < 0) return "";
  const noted = Boolean(noteFor(state, demo.pointId));
  if (state.screen === "options") {
    return "Tap an answer. Choosing it starts the 5-second send; tap to undo.";
  }
  if (state.screen === "review") {
    if (!noted) {
      if (state.focus === pointIndex) {
        return "It opens on step 4: it would sign out every customer. Tap and say what to change.";
      }
      if (state.focus < pointIndex) return "Step 4 is below. Scroll to it.";
      return "Step 4 is above. Scroll back to the risky step.";
    }
    if (state.focus < state.deck.points.length) return "Note saved. Scroll to the Send row.";
    return "Note saved. Send is selected — tap to send, with 5 seconds to undo.";
  }
  return "";
}

function setCaption(text: string, step: number): void {
  elements.playback.hidden = false;
  elements.playbackStep.textContent = String(step);
  elements.playbackText.textContent = text;
}

function stopWatch(message?: string, cancelSend = false): void {
  if (!watch) return;
  watch.cancelled = true;
  watch = null;
  playFinished = false;
  elements.playbackStop.hidden = false;
  elements.playButton.classList.remove("is-playing");
  if (cancelSend && state.screen === "countdown") state = cancelCountdown(state);
  if (message) {
    setCaption(message, 0);
    elements.playbackStep.textContent = "–";
  }
  render();
}

async function startWatch(): Promise<void> {
  if (watch) {
    stopWatch("Playback stopped.");
    return;
  }
  if (!dataset.demo) return;
  await resetSim(true);
  const script = dataset.demo;
  const run = { cancelled: false };
  watch = run;
  playFinished = false;
  elements.playback.hidden = false;
  elements.playbackStop.hidden = false;
  render();

  const check = () => {
    if (run.cancelled) throw new Error("cancelled");
  };
  const waitFor = async (predicate: () => boolean, timeout = 9_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      check();
      if (predicate()) return;
      await sleep(60);
    }
    throw new Error("timeout");
  };
  const moveTo = async (predicate: () => boolean, direction: "up" | "down") => {
    let guard = 0;
    while (!predicate() && guard < 12) {
      check();
      await handleGesture(direction, "script");
      await sleep(330);
      guard++;
    }
  };

  try {
    setCaption(script.captions.open, 1);
    await sleep(650);

    const inboxIndex = state.inbox.findIndex((item) => item.threadId === script.threadId);
    if (inboxIndex < 0) throw new Error("missing thread");
    await moveTo(() => state.inboxFocus === inboxIndex, state.inboxFocus < inboxIndex ? "down" : "up");
    await sleep(420);
    await handleGesture("tap", "script");
    await waitFor(() => state.deck !== null && (state.screen === "review" || state.screen === "options"));
    await sleep(900);

    setCaption(script.captions.focus, 2);
    const pointIndex = state.deck?.points.findIndex((point) => point.id === script.pointId) ?? -1;
    if (pointIndex < 0) throw new Error("missing point");
    await moveTo(() => state.focus === pointIndex, state.focus < pointIndex ? "down" : "up");
    await sleep(760);

    setCaption(script.captions.talk, 3);
    await sleep(400);
    await handleGesture("tap", "script");
    await waitFor(() => state.recordingStartedAt !== null);
    await sleep(1_500);
    check();
    await applyTypedNote(script.note);
    await sleep(700);

    setCaption(script.captions.sendRow, 4);
    const sendIndex = state.deck?.points.length ?? 0;
    await moveTo(() => state.focus === sendIndex, state.focus < sendIndex ? "down" : "up");
    await sleep(760);

    await handleGesture("tap", "script");
    await waitFor(() => state.screen === "countdown", 2_000);
    setCaption(script.captions.preview, 5);
    await sleep(1_200);

    await waitFor(() => state.screen === "receipt" || state.screen === "inbox", 7_000);
    setCaption(script.captions.sending, 6);
    await waitFor(() => Boolean(backend.historyFor(script.threadId).reply), 12_000);
    check();
    setCaption(script.captions.reply, 7);
    playFinished = true;
    elements.playbackStop.hidden = true;
    watch = null;
    elements.playButton.classList.remove("is-playing");
    render();
  } catch {
    if (!run.cancelled) {
      watch = null;
      setCaption("Playback stopped. Try the ring yourself — it is the same screen.", 0);
      elements.playbackStep.textContent = "–";
      elements.playbackStop.hidden = true;
      playFinished = false;
      render();
    }
  }
}

/* ---------------- reset + datasets ---------------- */

async function resetSim(silent = false): Promise<void> {
  if (resetInFlight) return;
  resetInFlight = true;
  stopWatch();
  clearTimeout(saveTimer);
  recordToken++;
  recorder.cancel();
  transcribing = false;
  fallbackOpen = false;
  closeMenu();
  unsubscribe();
  backend.dispose();
  backend = new SimBackend(dataset);
  unsubscribe = backend.subscribe(handleSimEvent);
  state = initialState({ demo: true, loading: true });
  panelThreadId = null;
  panelThread = null;
  panelIsReply = false;
  panelNotes = [];
  guideDismissed = false;
  playFinished = false;
  lastSwipeAt = Number.NEGATIVE_INFINITY;
  lastDoubleAt = 0;
  elements.playback.hidden = true;
  elements.playbackStop.hidden = false;
  render();
  await loadInbox(false);
  if (!silent) {
    state = setFlash(state, "Simulator reset", Date.now(), 2_500);
    render();
  }
  resetInFlight = false;
}

async function switchDataset(id: string): Promise<void> {
  const next = DATASETS.find((entry) => entry.id === id);
  if (!next || next.status !== "ready" || next.id === dataset.id) return;
  dataset = next;
  renderTabs();
  await resetSim(true);
  updateStage(Date.now());
}

/* ---------------- backend events ---------------- */

function handleSimEvent(event: SimEvent): void {
  if (event.type === "opened") {
    const sameThread = panelThreadId === event.threadId;
    panelThreadId = event.threadId;
    panelThread = event.thread;
    panelIsReply = event.isReply;
    if (!event.isReply) {
      panelNotes = backend.draft(event.threadId)?.notes ?? [];
    } else if (!sameThread) {
      panelNotes = [];
    }
    render();
    return;
  }
  if (event.type === "draft") {
    render();
    return;
  }
  if (event.type === "sent") {
    if (panelThreadId === null) {
      panelThreadId = event.threadId;
      panelThread = backend.thread(event.threadId) ?? panelThread;
      panelIsReply = false;
      panelNotes = [];
    }
    render();
    return;
  }
  if (event.type === "reply") {
    if (panelThreadId === null) {
      panelThreadId = event.threadId;
      panelThread = backend.thread(event.threadId) ?? panelThread;
    }
    state = { ...state, resolved: state.resolved.filter((id) => id !== event.threadId) };
    render();
    void loadInbox(true);
    if (state.screen === "inbox") {
      state = setFlash(state, "Agent replied", Date.now(), 3_000);
      render();
    }
    return;
  }
  if (event.type === "inbox") {
    void loadInbox(true);
    return;
  }
  if (event.type === "reset") {
    panelThreadId = null;
    panelThread = null;
    panelIsReply = false;
    panelNotes = [];
    render();
  }
}

/* ---------------- setup ---------------- */

const ring = new RingController(elements.stage, (gesture) => {
  void handleGesture(gesture, "user");
});
void ring;

// Warm the audio context on the first real gesture (iOS Safari requirement).
document.addEventListener("pointerdown", () => recorder.prime(), { once: true, capture: true });
document.addEventListener("keydown", () => recorder.prime(), { once: true, capture: true });

elements.playButton.addEventListener("click", () => {
  if (watch) stopWatch("Playback stopped.", true);
  else void startWatch();
});
elements.playbackStop.addEventListener("click", () => stopWatch("Playback stopped.", true));
elements.resetButton.addEventListener("click", () => void resetSim());
elements.guideDismiss.addEventListener("click", () => {
  guideDismissed = true;
  render();
});
elements.typeLink.addEventListener("click", () => openFallback());
elements.fallbackClose.addEventListener("click", closeFallback);
elements.fallbackForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitTypedNote(elements.fallbackInput.value);
  elements.fallbackInput.value = "";
  elements.fallbackInput.focus();
});
elements.datasetTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dataset]");
  if (!button || button.disabled) return;
  void switchDataset(button.dataset.dataset ?? "");
});

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (elements.menu.hidden) return;
  if (elements.menu.contains(target)) return;
  if (target.closest('[data-ring-action="hold"]')) return;
  closeMenu();
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) {
    if (event.key === "Escape") closeFallback();
    return;
  }
  if (!elements.menu.hidden && event.key === "Escape") {
    closeMenu();
    event.preventDefault();
    return;
  }
  if (target?.closest("button, a") && !target.closest("[data-ring]")) return;
  const rect = elements.stage.getBoundingClientRect();
  const inView = rect.bottom > 120 && rect.top < window.innerHeight - 60;
  if (!inView && !target?.closest("#stage")) return;

  const actions: Record<string, Gesture | undefined> = {
    ArrowUp: "up",
    ArrowDown: "down",
    Enter: "tap",
    Escape: "double",
    Backspace: "double",
    h: "hold",
    H: "hold",
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  void handleGesture(action, "user");
});

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  if (state.recordingStartedAt === null) return;
  recorder.cancel();
  recordToken++;
  state = endRecording(state);
  state = setFlash(state, "Recording stopped", Date.now(), 3_000);
  render();
});

renderTabs();
render();
void loadInbox(false);
