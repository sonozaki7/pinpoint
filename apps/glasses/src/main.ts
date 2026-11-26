import "./style.css";
import type { InboxItem, ThreadAttention } from "../../../shared/contract";
import {
  APP_VERSION, DEVICE_BUILD, HttpPinpointApi, isNetworkFailure, SERVER_IS_CLOUD, SERVER_URL,
  type PinpointApi,
} from "./api";
import { MockPinpointApi } from "./mock";
import {
  adoptInbox, applyEdit, applyHealth, applyVoice, cancelCountdown, clearFlash, clearNotes, countdownDue, deckFailed, doubleTap,
  draftFor, endRecording, finishSend, focusedPoint, initialState, markLoading, markOffline, markSending,
  mergeDeck, moveFocus, noteFor, openDeck, press, receiptDue, recordingOnSurface, recordingTickDelay,
  resetWorkspace, sendFailed, setFlash, setInboxFocus, shouldAcceptSwipe, showReceipt, startCountdown,
  startInboxCountdown, startReview, RECEIPT_HOLD_MS,
  type Effect, type State,
} from "./model";
import { pageFor, type PageModel } from "./display";
import { connectEven } from "./even";
import type { Input } from "./events";
import { PcmRecorder, SilenceGate } from "./voice";

const params = new URLSearchParams(location.search);
const forceMock = params.get("mock") === "1";
const bootedAt = Date.now();

let api: PinpointApi = new MockPinpointApi({ extended: forceMock });
let state = initialState({ demo: forceMock, loading: true, cloud: SERVER_IS_CLOUD });
const recorder = new PcmRecorder();
const silence = new SilenceGate();
let hardware: Awaited<ReturnType<typeof connectEven>> | undefined;
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let tapTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastMenuAt = 0;
let lastDoubleAt = 0;
let lastSwipeAt = Number.NEGATIVE_INFINITY;
let lastForegroundRefresh = 0;
let sendInFlight = false;
let inboxInFlight = false;
let resetInFlight = false;
let samplePoll = 0;
/** A cold live deck can take ~45 s; give it 70 s before offering retry. */
const DECK_WAIT_MS = 70_000;
const SAMPLE_POLL_MS = 2_000;
const SAMPLE_POLL_ATTEMPTS = 7;

const el = {
  head: document.getElementById("glasses-head")!,
  list: document.getElementById("glasses-list")!,
  rows: document.getElementById("glasses-rows")!,
  pane: document.getElementById("glasses-pane")!,
  footer: document.getElementById("glasses-footer")!,
  badge: document.getElementById("mode-badge")!,
  host: document.getElementById("host-status")!,
  note: document.getElementById("panel-note")!,
  menu: document.getElementById("menu-panel")!,
  menuItems: document.getElementById("menu-items")!,
  up: document.querySelector<HTMLButtonElement>("#btn-up")!,
  down: document.querySelector<HTMLButtonElement>("#btn-down")!,
  tap: document.querySelector<HTMLButtonElement>("#btn-tap")!,
  double: document.querySelector<HTMLButtonElement>("#btn-double")!,
  menuButton: document.querySelector<HTMLButtonElement>("#btn-menu")!,
  modeLink: document.querySelector<HTMLAnchorElement>("#mode-link")!,
  phoneStatus: document.getElementById("phone-status")!,
  phoneServer: document.getElementById("phone-server")!,
  phoneVersion: document.getElementById("phone-version")!,
  statusDot: document.getElementById("status-dot")!,
  resetSample: document.querySelector<HTMLButtonElement>("#btn-reset-sample")!,
  retry: document.querySelector<HTMLButtonElement>("#btn-retry")!,
  resetNote: document.getElementById("reset-note")!,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function setText(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

function render() {
  const page = pageFor(state, Date.now());
  renderBrowser(page);
  void hardware?.render(page);
  updateButtons();
  updateMode();
  updatePhone();
  scheduleClock();
}

function renderBrowser(page: PageModel) {
  setText(el.badge, state.demo ? "Demo data" : state.cloud ? "Pinpoint Cloud" : "Live server");
  setText(el.head, page.subtitle ? `${page.title}\n${page.subtitle}` : page.title);
  setText(el.pane, page.pane ?? page.message ?? "");
  setText(el.footer, page.footer);

  const hasList = Boolean(page.list);
  el.list.hidden = !hasList;
  el.list.replaceChildren();
  if (page.list) {
    page.list.forEach((text, index) => {
      const item = document.createElement("li");
      item.textContent = text;
      item.className = index === state.inboxFocus ? "selected" : "";
      item.addEventListener("click", () => {
        state = setInboxFocus(state, index);
        handleInput({ kind: "tap", listIndex: index });
      });
      el.list.append(item);
    });
  }

  el.rows.hidden = page.rows.length === 0;
  el.rows.replaceChildren();
  page.rows.forEach((row) => {
    const node = document.createElement("div");
    node.className = "row";
    node.dataset.brightness = String(row.brightness);
    node.textContent = row.text;
    el.rows.append(node);
  });
  el.pane.hidden = !(page.pane ?? page.message);
}

function updateButtons() {
  const record = state.recordingStartedAt !== null;
  const sendRow = state.screen === "review" && state.deck !== null && state.focus >= state.deck.points.length;
  setText(el.tap, state.screen === "inbox"
    ? "Open"
    : state.screen === "options"
      ? "Choose"
      : state.screen === "countdown"
        ? "Undo"
        : state.screen === "receipt"
          ? "Inbox"
          : state.screen === "preview"
            ? state.sent || state.sending
              ? "Wait"
              : state.preview || state.previewLoading ? "Back" : "Retry"
            : state.screen === "review" && state.deck === null
              ? "Retry"
              : record
                ? "Stop"
                : sendRow ? "Send" : focusedPoint(state)?.kind === "question" ? "Options" : "Talk");
  setText(el.double, state.screen === "countdown"
    ? "Undo"
    : state.screen === "receipt"
      ? "Inbox"
      : state.screen === "options"
        ? "List"
        : state.screen === "preview" && state.preview
          ? "Send"
          : state.screen === "inbox" ? "Exit" : "Back");
  setText(el.menuButton, "Hold menu");
  el.up.disabled = ifInboxEmpty();
  el.down.disabled = ifInboxEmpty();
  el.note.textContent = state.demo
    ? "Demo data runs entirely in this browser. Use ?mock=1 to force it."
    : `${state.cloud ? "Cloud" : "Local"} mode: posting to ${SERVER_URL}`;
  el.modeLink.textContent = state.demo ? "Try the live server" : "Force demo data";
  el.modeLink.href = state.demo ? location.pathname : `${location.pathname}?mock=1`;
}

function updatePhone() {
  const cloud = state.cloud;
  const serverName = cloud ? "Pinpoint Cloud" : "Local server";
  const workspace = state.workspace === "sample"
    ? "Sample workspace"
    : state.workspace === "desk"
      ? "Desk workspace"
      : null;
  const status = state.demo
    ? "Demo data · offline preview"
    : [serverName, workspace, state.offline ? "offline" : state.loading ? "connecting..." : "online"]
      .filter(Boolean)
      .join(" · ");
  setText(el.phoneStatus, status);
  el.statusDot.dataset.state = state.demo
    ? "demo"
    : state.offline
      ? "offline"
      : state.loading
        ? "connecting"
        : "online";
  setText(
    el.phoneServer,
    state.serverVersion
      ? `Server version ${state.serverVersion}`
      : state.offline
        ? "Server not reachable"
        : "Server version unknown",
  );
  setText(el.phoneVersion, `App ${APP_VERSION}`);
  const sample = state.workspace === "sample";
  el.resetSample.disabled = !sample || resetInFlight || state.sending;
  setText(el.resetSample, resetInFlight ? "Resetting..." : "Reset sample workspace");
  el.resetNote.hidden = sample;
}

function ifInboxEmpty() {
  return state.screen === "inbox" && state.inbox.length === 0;
}

function updateMode() {
  document.body.dataset.mode = state.demo ? "demo" : "live";
}

function maybePersist(previous: State, next: State) {
  if (previous.notes === next.notes && previous.seen === next.seen) return;
  const draft = draftFor(next, Date.now());
  if (!draft) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void api.putReview(draft).catch((error) => console.warn("[pinpoint] autosave", error));
  }, 300);
}

function scheduleClock() {
  clearTimeout(clockTimer);
  const now = Date.now();
  if (state.recordingStartedAt !== null) {
    const delay = recordingTickDelay(now, state.recordingStartedAt);
    if (delay <= 0) {
      void stopRecording();
      return;
    }
    clockTimer = setTimeout(() => render(), Math.max(60, delay));
    return;
  }
  if (state.screen === "countdown" && state.countdownStartedAt !== null) {
    // One pane update per second, then the send itself. A tap cancels first.
    if (countdownDue(state, now)) {
      void sendReview();
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

function handleInput(input: Input) {
  if (input.kind === "audio") {
    if (state.recordingStartedAt !== null) {
      recorder.push(input.pcm);
      if (silence.push(input.pcm)) void stopRecording();
    }
    return;
  }
  if (input.kind === "hold") {
    // The OS claims tap-then-hold for its own contextual menu and then delivers
    // the choice as `menu`. This raw pair is for hosts that do not claim it;
    // cancel the pending 260 ms tap so it cannot fire under the overlay.
    clearTimeout(tapTimer);
    tapTimer = undefined;
    console.info(`[pinpoint] hold ${input.phase}`);
    return;
  }
  if (input.kind === "exit") {
    console.info(`[pinpoint] exit reason=${input.reason} abnormal=${input.abnormal}`);
    clearTimeout(tapTimer);
    tapTimer = undefined;
    recorder.stop();
    void hardware?.mic(false);
    state = endRecording(state);
    return;
  }
  if (input.kind === "surface") {
    // Opening or closing the menu or the exit dialog also delivers a foreground
    // event; a queued tap must not land under that overlay.
    clearTimeout(tapTimer);
    tapTimer = undefined;
    if (input.enter) {
      onForeground();
    } else if (abortRecording("Recording stopped")) {
      console.info("[pinpoint] recording stopped by background");
    }
    render();
    return;
  }
  if (input.kind === "menu") {
    clearTimeout(tapTimer);
    tapTimer = undefined;
    void handleMenu(input.id);
    return;
  }
  if (input.kind === "up" || input.kind === "down") {
    const now = performance.now();
    if (!shouldAcceptSwipe(now, lastSwipeAt)) return;
    lastSwipeAt = now;
    clearTimeout(tapTimer);
    tapTimer = undefined;
    const before = state;
    if (state.screen === "inbox") {
      // A list event without an index means the first row, not "keep the old
      // highlight". A host without a native list (the browser preview, or a
      // ring event that bypasses it) still moves our own highlight.
      if (input.fromList) state = setInboxFocus(state, input.listIndex ?? 0);
      else state = moveFocus(state, input.kind === "up" ? -1 : 1);
    } else {
      state = moveFocus(state, input.kind === "up" ? -1 : 1);
    }
    maybePersist(before, state);
    render();
    if (state.screen === "review") {
      console.info(`[pinpoint] focus=${state.focus + 1}`);
    }
    return;
  }
  if (input.kind === "double") {
    clearTimeout(tapTimer);
    tapTimer = undefined;
    const now = performance.now();
    if (now - lastDoubleAt < 350) return;
    lastDoubleAt = now;
    dispatch("double");
    return;
  }
  const before = state;
  if (state.screen === "inbox" && input.fromList) {
    state = setInboxFocus(state, input.listIndex ?? 0);
  }
  maybePersist(before, state);
  render();
  clearTimeout(tapTimer);
  const tappedIndex = input.fromList ? input.listIndex : undefined;
  tapTimer = setTimeout(() => {
    tapTimer = undefined;
    dispatch("tap", tappedIndex);
  }, 260);
}

async function dispatch(kind: "tap" | "double", listIndex?: number) {
  const before = state;
  const result = kind === "tap" ? press(state, Date.now(), listIndex) : doubleTap(state);
  state = result.state;
  if (before.screen !== state.screen) {
    console.info(`[pinpoint] screen ${before.screen}->${state.screen}`);
  }
  if (before.recordingStartedAt !== null && state.recordingStartedAt === null && result.effect?.type !== "record-stop") {
    discardRecording();
  }
  maybePersist(before, state);
  render();
  if (result.effect) await runEffect(result.effect);
}

async function runEffect(effect: Effect) {
  switch (effect.type) {
    case "exit":
      console.info("[pinpoint] exit-dialog");
      if (hardware) {
        await hardware.exit();
      } else {
        setText(el.host, "Exit dialog is shown on the glasses only");
      }
      break;
    case "open":
      await openThread(effect.index);
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

function unreachableText(): string {
  return state.cloud
    ? "Can't reach Pinpoint Cloud.\nCheck your phone's internet.\nTap to retry."
    : "Can't reach the local server.\nStart it, then tap to retry.";
}

function shortUnreachable(): string {
  return state.cloud
    ? "Can't reach Pinpoint Cloud. Tap to retry."
    : "Can't reach the local server. Tap to retry.";
}

async function loadInbox(silent: boolean) {
  if (inboxInFlight) return;
  inboxInFlight = true;
  try {
    if (!silent) {
      state = markLoading(state);
      render();
    }
    const [inboxResult, healthResult] = await Promise.allSettled([api.inbox(), api.health()]);
    if (inboxResult.status === "fulfilled") {
      state = adoptInbox(state, inboxResult.value.items, { demo: api.mode === "demo", offline: false });
      if (healthResult.status === "fulfilled") state = applyHealth(state, healthResult.value);
    } else {
      console.warn("[pinpoint] inbox", inboxResult.reason);
      if (healthResult.status === "fulfilled") state = applyHealth(state, healthResult.value);
      if (!silent || state.screen === "inbox") state = markOffline(state, unreachableText());
    }
    render();
  } finally {
    inboxInFlight = false;
  }
  if (state.screen === "inbox") {
    console.info(`[pinpoint] screen=inbox items=${state.inbox.length}${state.demo ? " demo" : ""}`);
    console.info(`[pinpoint] inbox-ids=${state.inbox.map((item) => item.threadId).join(",")}`);
    console.info(`[pinpoint] inbox-header="${pageFor(state, Date.now()).title}"`);
  }
}

async function boot() {
  console.info(`[pinpoint] server=${forceMock ? "mock" : SERVER_URL}`);
  if (!forceMock) {
    api = new HttpPinpointApi(SERVER_URL);
    await loadInbox(false);
  } else {
    const [result, health] = await Promise.all([api.inbox(), api.health()]);
    state = adoptInbox(state, result.items, { demo: true, offline: false });
    state = applyHealth(state, health);
    render();
  }
  console.info(`[pinpoint] mode=${state.demo ? "demo" : "live"} screen=inbox items=${state.inbox.length}`);
  console.info(`[pinpoint] inbox-ids=${state.inbox.map((item) => item.threadId).join(",")}`);
  console.info(`[pinpoint] inbox-header="${pageFor(state, Date.now()).title}"`);
}

async function openThread(index: number) {
  const item = state.inbox[index];
  if (!item) return;
  await openThreadItem(item);
}

async function retryDeck() {
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

async function openThreadItem(item: InboxItem) {
  state = startReview(state, item);
  render();
  console.info(`[pinpoint] opening=${item.threadId}`);
  const deadline = Date.now() + DECK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await api.deck(item.threadId);
      if (state.loadingThreadId !== item.threadId) return;
      if ("pending" in result) {
        await sleep(700);
        continue;
      }
      const before = state;
      state = openDeck(state, result);
      maybePersist(before, state);
      render();
      console.info(`[pinpoint] screen=review thread=${result.threadId} focus=${state.focus + 1} points=${result.points.length}`);
      console.info(`[pinpoint] review-header="${pageFor(state, Date.now()).title}"`);
      return;
    } catch (error) {
      console.warn("[pinpoint] deck", error);
      if (state.loadingThreadId !== item.threadId) return;
      state = deckFailed(
        state,
        isNetworkFailure(error) ? shortUnreachable() : "Could not load points. Tap to retry.",
        Date.now(),
      );
      render();
      return;
    }
  }
  if (state.loadingThreadId === item.threadId) {
    state = deckFailed(state, "Still building. Tap to retry.", Date.now());
    render();
  }
}

async function startRecording() {
  if (state.recordingStartedAt === null) return;
  recorder.start();
  silence.reset();
  console.info(`[pinpoint] recording point=${focusedPoint(state)?.id ?? "none"}`);
  const ok = await hardware?.mic(true);
  if (ok === false) {
    recorder.stop();
    state = endRecording(setFlash(state, "Mic unavailable. Tap to retry.", Date.now()));
    render();
  }
}

function discardRecording() {
  recorder.stop();
  void hardware?.mic(false);
  console.info("[pinpoint] recording discarded");
}

async function stopRecording() {
  if (state.recordingStartedAt === null) return;
  const point = focusedPoint(state);
  const threadId = state.deck?.threadId;
  state = endRecording(state);
  // No silent waits: transcription can take a moment on the live server.
  state = setFlash(state, "Working...", Date.now(), 60_000);
  render();
  await hardware?.mic(false);
  const pcm = recorder.stop();
  console.info(`[pinpoint] voice pcm-bytes=${pcm.length}`);
  const before = state;
  try {
    const { text, verdict } = await api.voice(
      pcm,
      point && threadId ? { threadId, pointId: point.id } : undefined,
    );
    state = applyVoice(state, text, Date.now(), verdict);
    maybePersist(before, state);
    const noted = point ? noteFor(state, point.id) : undefined;
    console.info(`[pinpoint] note=${point?.id ?? "none"} verdict=${noted?.verdict ?? "none"} text="${text}"`);
    if (state.pendingEdit) await applyPendingEdit();
    console.info(`[pinpoint] review-header="${pageFor(state, Date.now()).title}"`);
  } catch (error) {
    console.warn("[pinpoint] voice", error);
    state = setFlash(
      state,
      isNetworkFailure(error) ? (state.cloud ? "Can't reach Pinpoint Cloud. Try again." : "Can't reach the local server. Try again.") : "Voice failed. Try again.",
      Date.now(),
    );
  }
  render();
}

/**
 * A 'draft' point is fixed in place: POST the spoken note and show the returned
 * sentence at once. The note stays saved if the edit fails.
 */
async function applyPendingEdit() {
  const pending = state.pendingEdit;
  if (!pending) return;
  const before = state;
  try {
    const result = await api.edit(pending.threadId, pending.pointId, pending.text);
    state = applyEdit(state, result);
    console.info(`[pinpoint] edit=${pending.pointId} ok=${result.ok} method=${result.method ?? "none"} after="${result.after ?? ""}"`);
  } catch (error) {
    console.warn("[pinpoint] edit", error);
    state = applyEdit(state, {
      ok: false,
      pointId: pending.pointId,
      before: "",
      error: "Couldn't change this line",
    });
  }
  maybePersist(before, state);
  render();
}

async function sendReview() {
  const threadId = state.deck?.threadId ?? state.pendingSend?.threadId;
  if (!threadId || sendInFlight || state.sending) return;
  // A debounced autosave must not land after send clears the draft and
  // recreate it with the notes that were just delivered.
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const known = new Map<string, ThreadAttention>(
    state.inbox.map((item) => [item.threadId, item.attention]),
  );
  if (state.deck) known.set(state.deck.threadId, state.deck.attention);
  state = markSending(state);
  render();
  sendInFlight = true;
  try {
    const draft = draftFor(state, Date.now());
    if (draft) await api.putReview(draft);
    const result = await api.send(threadId);
    if (!result.ok) {
      console.warn("[pinpoint] send rejected", result.error);
      state = sendFailed(state, "Send failed. Try again.", Date.now());
      render();
      return;
    }
    console.info(`[pinpoint] sent ${result.delivered} lines=${result.receipt?.lines.length ?? 0}`);
    state = showReceipt(state, result, Date.now());
    render();
    if (state.workspace === "sample") void pollSampleReply(known);
  } catch (error) {
    console.warn("[pinpoint] send", error);
    state = sendFailed(
      state,
      isNetworkFailure(error) ? shortUnreachable() : "Send failed. Try again.",
      Date.now(),
    );
    render();
  } finally {
    sendInFlight = false;
  }
}

/** The sample agent replies about 5 s after a send; refresh quietly until it lands. */
async function pollSampleReply(known: Map<string, ThreadAttention>) {
  const run = ++samplePoll;
  for (let attempt = 0; attempt < SAMPLE_POLL_ATTEMPTS; attempt++) {
    await sleep(SAMPLE_POLL_MS);
    if (run !== samplePoll || state.workspace !== "sample") return;
    await loadInbox(true);
    if (run !== samplePoll) return;
    const reply = state.inbox.find((item) => {
      const before = known.get(item.threadId);
      return item.attention === "report" && before !== "report";
    });
    if (reply) {
      console.info(`[pinpoint] sample-reply=${reply.threadId}`);
      if (state.screen === "inbox") {
        state = setFlash(state, "Agent replied", Date.now(), 3_000);
        render();
      }
      return;
    }
  }
}

function finishSent() {
  if (state.screen !== "receipt") return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  state = finishSend(state);
  render();
  console.info(`[pinpoint] screen=inbox items=${state.inbox.length} focus=${state.inboxFocus}`);
  void loadInbox(true);
}

async function refreshCurrent() {
  const deck = state.deck;
  if (!deck) {
    await retryDeck();
    return;
  }
  try {
    const result = await api.deck(deck.threadId);
    if ("pending" in result) {
      state = setFlash(state, "Still building points", Date.now(), 2_500);
    } else if (state.deck?.threadId === deck.threadId) {
      state = mergeDeck(state, result);
      state = setFlash(state, "Refreshed", Date.now(), 2_000);
      console.info(`[pinpoint] refreshed points=${result.points.length}`);
    }
  } catch (error) {
    console.warn("[pinpoint] refresh", error);
    state = setFlash(state, "Refresh failed", Date.now(), 3_000);
  }
  render();
}

async function readOnPhone() {
  const deck = state.deck;
  const point = focusedPoint(state) ?? deck?.points[deck.points.length - 1];
  if (!deck || !point) return;
  if (state.workspace === "sample") {
    state = setFlash(state, "No phone link in sample workspace", Date.now(), 4_000);
    render();
    return;
  }
  try {
    const result = await api.phone(deck.threadId, point.id);
    if (result.link) console.info(`[pinpoint] phone-link=${result.link}`);
    state = setFlash(state, result.ok ? "Link ready on phone" : "Phone link failed", Date.now(), 3_000);
  } catch (error) {
    console.warn("[pinpoint] phone", error);
    state = setFlash(state, "Phone link failed", Date.now(), 3_000);
  }
  render();
}

async function handleMenu(id: number) {
  const now = Date.now();
  if (now - lastMenuAt < 300) return;
  lastMenuAt = now;
  if (id === 5) {
    await resetSampleWorkspace();
    return;
  }
  if (state.screen === "inbox") {
    if (id === 4) await loadInbox(false);
    if (id === 6) {
      const item = state.inbox[state.inboxFocus];
      if (item && item.attention !== "question") {
        state = startInboxCountdown(state, item, now);
        render();
        console.info(`[pinpoint] agree-send=${item.threadId}`);
      }
    }
    return;
  }
  switch (id) {
    case 1:
      // "Send review" is the same undo countdown as the Send row.
      if (state.screen === "countdown") {
        state = cancelCountdown(state);
        render();
      } else {
        state = startCountdown(state, Date.now());
        render();
      }
      break;
    case 2:
      await readOnPhone();
      break;
    case 3: {
      const before = state;
      state = clearNotes(state, Date.now());
      maybePersist(before, state);
      render();
      break;
    }
    case 4:
      await refreshCurrent();
      break;
  }
}

async function resetSampleWorkspace() {
  if (state.workspace !== "sample" || resetInFlight || sendInFlight || state.sending) return;
  samplePoll++;
  resetInFlight = true;
  updatePhone();
  try {
    await api.resetSample();
    state = resetWorkspace(state);
    render();
    await loadInbox(false);
    state = setFlash(state, "Sample reset", Date.now(), 3_000);
    console.info("[pinpoint] sample-reset");
    render();
  } catch (error) {
    console.warn("[pinpoint] reset sample", error);
    state = setFlash(
      state,
      isNetworkFailure(error) ? shortUnreachable() : "Reset failed. Try again.",
      Date.now(),
    );
    render();
  } finally {
    resetInFlight = false;
    updatePhone();
  }
}

/** Drop an in-flight recording and say so; returns false when idle. */
function abortRecording(message: string): boolean {
  const { state: next, discard } = recordingOnSurface(state);
  if (!discard) return false;
  state = next;
  recorder.stop();
  void hardware?.mic(false);
  state = setFlash(state, message, Date.now(), 3_000);
  console.info("[pinpoint] recording aborted");
  return true;
}

function stopRecordingForBackground() {
  if (abortRecording("Recording stopped")) render();
}

function onForeground() {
  // Coming back from a lock or an overlay cancels any recording and closes the
  // microphone. It is never re-armed automatically; the user taps to start.
  if (abortRecording("Recording canceled")) render();
  void hardware?.mic(false);
  const now = Date.now();
  if (now - bootedAt < 2_500) return;
  if (now - lastForegroundRefresh < 1_500) return;
  lastForegroundRefresh = now;
  void loadInbox(state.offline ? false : true);
}

function emit(kind: "up" | "down" | "tap" | "double") {
  if (kind === "up" || kind === "down") handleInput({ kind });
  else if (kind === "tap") handleInput({ kind: "tap" });
  else handleInput({ kind: "double" });
}

el.up.addEventListener("click", () => emit("up"));
el.down.addEventListener("click", () => emit("down"));
el.tap.addEventListener("click", () => emit("tap"));
el.double.addEventListener("click", () => emit("double"));
el.menuButton.addEventListener("click", () => {
  el.menu.hidden = !el.menu.hidden;
  if (!el.menu.hidden) renderMenu();
});
el.resetSample.addEventListener("click", () => { void resetSampleWorkspace(); });
el.retry.addEventListener("click", () => { void loadInbox(false); });

// SDK hosts report FOREGROUND_ENTER/EXIT; browsers and other hosts get this.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") stopRecordingForBackground();
  else onForeground();
});

function renderMenu() {
  const page = pageFor(state, Date.now());
  el.menuItems.replaceChildren();
  for (const item of page.menu) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.addEventListener("click", () => {
      el.menu.hidden = true;
      void handleMenu(item.id);
    });
    el.menuItems.append(button);
  }
  if (page.menu.length === 0) {
    const empty = document.createElement("span");
    empty.textContent = "This screen has no menu items.";
    el.menuItems.append(empty);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key === "ArrowUp") emit("up");
  else if (event.key === "ArrowDown") emit("down");
  else if (event.key === "Enter") emit("tap");
  else if (event.key === "Escape" || event.key === "Backspace") emit("double");
  else return;
  event.preventDefault();
});

render();

if (DEVICE_BUILD) el.modeLink.hidden = true;

void connectEven(
  () => pageFor(state, Date.now()),
  handleInput,
  (message) => setText(el.host, message),
).then((connected) => {
  hardware = connected;
  render();
}).catch((error) => {
  console.info("[pinpoint] glasses host unavailable", error);
  setText(el.host, "Browser preview · no glasses host");
});

void boot();
