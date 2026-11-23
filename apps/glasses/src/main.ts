import "./style.css";
import { DEFAULT_SERVER, HttpPinpointApi, type PinpointApi } from "./api";
import { MockPinpointApi } from "./mock";
import {
  adoptInbox, applyVoice, clearFlash, clearNotes, deckFailed, doubleTap, draftFor, endRecording,
  finishSend, focusedPoint, goPreview, initialState, markLoading, markOffline, markSent, mergeDeck,
  moveFocus, noteFor, openDeck, press, previewFailed, sendFailed, setFlash, setInboxFocus, setPreview,
  startReview, VOICE_MAX_MS, SENT_HOLD_MS, type Effect, type State,
} from "./model";
import { pageFor, type PageModel } from "./display";
import { connectEven } from "./even";
import type { Input } from "./events";
import { PcmRecorder } from "./voice";

const params = new URLSearchParams(location.search);
const forceMock = params.get("mock") === "1";
const deviceBuild = import.meta.env.MODE === "evenhub";
const serverUrl = (import.meta.env.VITE_PINPOINT_SERVER as string | undefined) ?? DEFAULT_SERVER;

let api: PinpointApi = new MockPinpointApi();
let state = initialState({ demo: forceMock, loading: true });
const recorder = new PcmRecorder();
let hardware: Awaited<ReturnType<typeof connectEven>> | undefined;
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let tapTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastMenuAt = 0;
let lastDoubleAt = 0;
let sendInFlight = false;

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
  scheduleClock();
}

function renderBrowser(page: PageModel) {
  setText(el.badge, state.demo ? "Demo data" : "Live server");
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
      : state.screen === "preview"
        ? "Send"
        : record
          ? "Stop"
          : sendRow ? "Preview" : focusedPoint(state)?.kind === "question" ? "Options" : "Talk");
  setText(el.double, state.screen === "inbox" ? "Exit" : "Back");
  setText(el.menuButton, "Hold menu");
  el.up.disabled = ifInboxEmpty();
  el.down.disabled = ifInboxEmpty();
  el.note.textContent = state.demo
    ? "Demo data runs entirely in this browser. Use ?mock=1 to force it."
    : `Live mode: posting to ${serverUrl}`;
  el.modeLink.textContent = state.demo ? "Try the live server" : "Force demo data";
  el.modeLink.href = state.demo ? location.pathname : `${location.pathname}?mock=1`;
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
    const elapsed = now - state.recordingStartedAt;
    if (elapsed >= VOICE_MAX_MS) {
      void stopRecording();
      return;
    }
    const delay = Math.min(1_000 - (elapsed % 1_000) + 30, VOICE_MAX_MS - elapsed);
    clockTimer = setTimeout(() => render(), Math.max(60, delay));
    return;
  }
  if (state.sent && state.sentAt !== null) {
    const left = state.sentAt + SENT_HOLD_MS - now;
    if (left <= 0) {
      finishSent();
      return;
    }
    clockTimer = setTimeout(finishSent, left);
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
    if (state.recordingStartedAt !== null) recorder.push(input.pcm);
    return;
  }
  if (input.kind === "surface") {
    render();
    return;
  }
  if (input.kind === "menu") {
    void handleMenu(input.id);
    return;
  }
  if (input.kind === "up" || input.kind === "down") {
    clearTimeout(tapTimer);
    tapTimer = undefined;
    const before = state;
    if (state.screen === "inbox" && input.listIndex !== undefined) {
      state = setInboxFocus(state, input.listIndex);
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
  if (state.screen === "inbox" && input.listIndex !== undefined) {
    state = setInboxFocus(state, input.listIndex);
  }
  maybePersist(before, state);
  render();
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    tapTimer = undefined;
    dispatch("tap");
  }, 260);
}

async function dispatch(kind: "tap" | "double") {
  const before = state;
  const result = kind === "tap" ? press(state, Date.now()) : doubleTap(state);
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
    case "preview":
      await openPreview();
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
  }
}

async function loadInbox(silent: boolean) {
  if (!silent) {
    state = markLoading(state);
    render();
  }
  try {
    const result = await api.inbox();
    state = adoptInbox(state, result.items, { demo: api.mode === "demo", offline: false });
  } catch (error) {
    console.warn("[pinpoint] inbox", error);
    if (!silent) state = markOffline(state);
  }
  render();
  if (state.screen === "inbox") {
    console.info(`[pinpoint] screen=inbox items=${state.inbox.length}${state.demo ? " demo" : ""}`);
    console.info(`[pinpoint] inbox-ids=${state.inbox.map((item) => item.threadId).join(",")}`);
    console.info(`[pinpoint] inbox-header="${pageFor(state, Date.now()).title}"`);
  }
}

async function boot() {
  console.info(`[pinpoint] server=${forceMock ? "mock" : serverUrl}`);
  if (!forceMock) {
    const live = new HttpPinpointApi(serverUrl);
    try {
      const result = await live.inbox();
      api = live;
      state = adoptInbox(state, result.items, { demo: false, offline: false });
    } catch (error) {
      console.info("[pinpoint] live server unavailable, using demo data", error);
      api = new MockPinpointApi();
      const result = await api.inbox();
      state = adoptInbox(state, result.items, { demo: true, offline: false });
    }
  } else {
    const result = await api.inbox();
    state = adoptInbox(state, result.items, { demo: true, offline: false });
  }
  render();
  console.info(`[pinpoint] mode=${state.demo ? "demo" : "live"} screen=inbox items=${state.inbox.length}`);
  console.info(`[pinpoint] inbox-ids=${state.inbox.map((item) => item.threadId).join(",")}`);
  console.info(`[pinpoint] inbox-header="${pageFor(state, Date.now()).title}"`);
}

async function openThread(index: number) {
  const item = state.inbox[index];
  if (!item) return;
  state = startReview(state, item);
  render();
  console.info(`[pinpoint] opening=${item.threadId}`);
  for (let attempt = 0; attempt < 40; attempt++) {
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
      state = deckFailed(state, "Could not load points", Date.now());
      render();
      return;
    }
  }
  if (state.loadingThreadId === item.threadId) {
    state = deckFailed(state, "Deck is still building", Date.now());
    render();
  }
}

async function startRecording() {
  if (state.recordingStartedAt === null) return;
  recorder.start();
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
  state = endRecording(state);
  render();
  await hardware?.mic(false);
  const pcm = recorder.stop();
  console.info(`[pinpoint] voice pcm-bytes=${pcm.length}`);
  const before = state;
  try {
    const { text, verdict } = await api.voice(pcm);
    state = applyVoice(state, text, Date.now(), verdict);
    maybePersist(before, state);
    const point = focusedPoint(state);
    const note = point ? noteFor(state, point.id) : undefined;
    console.info(`[pinpoint] note=${point?.id ?? "none"} verdict=${note?.verdict ?? "none"} text="${text}"`);
    console.info(`[pinpoint] review-header="${pageFor(state, Date.now()).title}"`);
  } catch (error) {
    console.warn("[pinpoint] voice", error);
    state = setFlash(state, "Voice failed. Try again.", Date.now());
  }
  render();
}

async function openPreview() {
  const before = state;
  state = goPreview(state);
  render();
  const deck = state.deck;
  const draft = draftFor(state, Date.now());
  if (!deck || !draft) {
    state = previewFailed(state, "No draft to preview", Date.now());
    render();
    return;
  }
  try {
    await api.putReview(draft);
    const preview = await api.preview(deck.threadId, draft);
    if (state.screen !== "preview") return;
    state = setPreview(state, preview);
    console.info(`[pinpoint] preview objections=${preview.counts.objections} answers=${preview.counts.answers} notes=${preview.counts.notes} agreed=${preview.counts.agreed}`);
  } catch (error) {
    console.warn("[pinpoint] preview", error);
    if (state.screen !== "preview") return;
    state = previewFailed(state, "Preview failed. Tap to retry.", Date.now());
  }
  maybePersist(before, state);
  render();
}

async function sendReview() {
  const deck = state.deck;
  if (!deck || sendInFlight || state.sent) return;
  sendInFlight = true;
  try {
    const draft = draftFor(state, Date.now());
    if (draft) await api.putReview(draft);
    const result = await api.send(deck.threadId);
    if (!result.ok) {
      state = sendFailed(state, result.error ?? "Send failed. Try again.", Date.now());
      render();
      return;
    }
    console.info(`[pinpoint] sent ${result.delivered}`);
    state = markSent(state, Date.now());
    render();
  } catch (error) {
    console.warn("[pinpoint] send", error);
    state = sendFailed(state, "Send failed. Try again.", Date.now());
    render();
  } finally {
    sendInFlight = false;
  }
}

function finishSent() {
  if (state.screen !== "preview" || !state.sent) return;
  state = finishSend(state);
  render();
  console.info(`[pinpoint] screen=inbox items=${state.inbox.length}`);
  void loadInbox(true);
}

async function refreshCurrent() {
  if (state.screen === "preview") {
    await openPreview();
    return;
  }
  const deck = state.deck;
  if (!deck) {
    await loadInbox(false);
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
  if (state.screen === "inbox") {
    if (id === 4) await loadInbox(false);
    return;
  }
  switch (id) {
    case 1:
      if (state.screen === "preview") await sendReview();
      else await openPreview();
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

if (deviceBuild) el.modeLink.hidden = true;

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
