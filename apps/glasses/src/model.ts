import type {
  Deck, Health, InboxItem, Note, Point, PreviewResult, ReviewDraft,
} from "../../../shared/contract";
export type ScreenName = "inbox" | "review" | "options" | "preview";

export interface Flash {
  text: string;
  until: number;
}

export interface SavedDraft {
  notes: Note[];
  seen: string[];
}

export interface State {
  screen: ScreenName;
  demo: boolean;
  loading: boolean;
  offline: boolean;
  /** Why the last inbox load failed; kept in plain language for the glasses. */
  offlineMessage: string | null;
  /** Cloud builds talk to Pinpoint Cloud; local builds talk to the desktop server. */
  cloud: boolean;
  workspace: "sample" | "desk" | null;
  serverVersion: string | null;
  inbox: InboxItem[];
  inboxFocus: number;
  deck: Deck | null;
  loadingThreadId: string | null;
  reviewThreadId: string | null;
  reviewTitle: string;
  deckError: string | null;
  focus: number;
  notes: Note[];
  seen: string[];
  drafts: Record<string, SavedDraft>;
  /** Threads handled on this device; the demo server keeps returning them, so hide them here. */
  resolved: string[];
  recordingStartedAt: number | null;
  optionsFocus: number;
  preview: PreviewResult | null;
  previewLoading: boolean;
  sending: boolean;
  sent: boolean;
  sentAt: number | null;
  flash: Flash | null;
}

export interface PressResult {
  state: State;
  effect?: Effect;
}

export type Effect =
  | { type: "exit" }
  | { type: "open"; index: number }
  | { type: "preview" }
  | { type: "send" }
  | { type: "record-start" }
  | { type: "record-stop" }
  | { type: "retry" }
  | { type: "retry-deck" };

export const REVIEW_ROWS = 4;
export const VOICE_MAX_MS = 20_000;
export const SENT_HOLD_MS = 1_500;
/** One swipe per 250 ms: the ring and touch surfaces both repeat fast. */
export const SWIPE_DEBOUNCE_MS = 250;

export function initialState(options: { demo: boolean; loading: boolean; cloud?: boolean }): State {
  return {
    screen: "inbox",
    demo: options.demo,
    loading: options.loading,
    offline: false,
    offlineMessage: null,
    cloud: options.cloud ?? false,
    workspace: null,
    serverVersion: null,
    inbox: [],
    inboxFocus: 0,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    reviewTitle: "",
    deckError: null,
    focus: 0,
    notes: [],
    seen: [],
    drafts: {},
    resolved: [],
    recordingStartedAt: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function focusedPoint(state: State): Point | undefined {
  return state.deck?.points[state.focus];
}

export function selectedPointId(state: State): string | undefined {
  const point = focusedPoint(state);
  return point?.id ?? state.deck?.points[state.deck.points.length - 1]?.id;
}

export function noteFor(state: State, pointId: string): Note | undefined {
  return state.notes.find((note) => note.pointId === pointId);
}

/** A send needs a loaded preview; the hold menu must not bypass it. */
export function canSend(state: State): boolean {
  return (
    state.screen === "preview" &&
    state.preview !== null &&
    !state.previewLoading &&
    !state.sending &&
    !state.sent
  );
}

export function countNotes(notes: readonly Note[]) {
  return {
    objections: notes.filter((note) => note.verdict === "object").length,
    answers: notes.filter((note) => note.verdict === "answer").length,
    notes: notes.filter((note) => note.verdict === "note").length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Debounce repeated scroll events; `lastSwipeAt` starts at -Infinity. */
export function shouldAcceptSwipe(
  now: number,
  lastSwipeAt: number,
  windowMs = SWIPE_DEBOUNCE_MS,
): boolean {
  return now - lastSwipeAt >= windowMs;
}

function remember(state: State): State {
  const deck = state.deck;
  if (!deck) return state;
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [deck.threadId]: { notes: state.notes, seen: state.seen },
    },
  };
}

function withSeen(state: State, point: Point | undefined): State {
  if (!point || state.seen.includes(point.id)) return state;
  return remember({ ...state, seen: [...state.seen, point.id] });
}

export function adoptInbox(
  state: State,
  items: readonly InboxItem[],
  options: { demo: boolean; offline: boolean },
): State {
  const visible = items.filter((item) => !state.resolved.includes(item.threadId));
  const capped = visible.slice(0, 20);
  const existing = capped.some((item) => item.threadId === state.inbox[state.inboxFocus]?.threadId);
  return {
    ...state,
    inbox: [...capped],
    inboxFocus: existing ? state.inboxFocus : 0,
    demo: options.demo,
    offline: options.offline,
    offlineMessage: options.offline ? state.offlineMessage : null,
    loading: false,
  };
}

/** Cloud health names the workspace this device is looking at. */
export function applyHealth(state: State, health: Health | undefined): State {
  if (!health) return state;
  return {
    ...state,
    cloud: health.mode === "cloud" ? true : state.cloud,
    workspace: health.workspace ?? null,
    serverVersion: health.version ?? null,
  };
}

export function markOffline(state: State, message?: string): State {
  return {
    ...state,
    loading: false,
    offline: true,
    offlineMessage: message ?? state.offlineMessage,
  };
}

export function markLoading(state: State): State {
  return { ...state, loading: true, offline: false, offlineMessage: null };
}

export function setInboxFocus(state: State, index: number): State {
  const focus = clamp(index, 0, Math.max(0, state.inbox.length - 1));
  return focus === state.inboxFocus ? state : { ...state, inboxFocus: focus };
}

export function moveFocus(state: State, delta: number): State {
  if (state.screen === "inbox") {
    return setInboxFocus(state, state.inboxFocus + delta);
  }
  if (state.screen === "options") {
    const total = (state.deck?.points[state.focus]?.options?.length ?? 0) + 1;
    const focus = clamp(state.optionsFocus + delta, 0, total - 1);
    return focus === state.optionsFocus ? state : { ...state, optionsFocus: focus };
  }
  if (state.screen === "review") {
    if (state.recordingStartedAt !== null || !state.deck) return state;
    const max = state.deck.points.length;
    const focus = clamp(state.focus + delta, 0, max);
    if (focus === state.focus) return state;
    return withSeen({ ...state, focus, flash: null }, state.deck.points[focus]);
  }
  return state;
}

export function startReview(state: State, item: InboxItem): State {
  const saved = state.drafts[item.threadId];
  return {
    ...state,
    screen: "review",
    deck: null,
    loadingThreadId: item.threadId,
    reviewThreadId: item.threadId,
    reviewTitle: item.title,
    deckError: null,
    focus: 0,
    notes: saved?.notes ?? [],
    seen: saved?.seen ?? [],
    recordingStartedAt: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function openDeck(state: State, deck: Deck): State {
  if (state.loadingThreadId !== deck.threadId && state.deck?.threadId !== deck.threadId) return state;
  const saved = state.drafts[deck.threadId];
  const notes = saved?.notes ?? [];
  const seen = saved?.seen ?? [];
  const next: State = {
    ...state,
    screen: "review",
    deck,
    loadingThreadId: null,
    reviewThreadId: deck.threadId,
    reviewTitle: deck.title,
    deckError: null,
    focus: 0,
    notes: notes.filter((note) => deck.points.some((point) => point.id === note.pointId)),
    seen: seen.filter((id) => deck.points.some((point) => point.id === id)),
    recordingStartedAt: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
  return withSeen(next, deck.points[0]);
}

export function mergeDeck(state: State, deck: Deck): State {
  if (state.deck?.threadId !== deck.threadId) return state;
  const pointIds = new Set(deck.points.map((point) => point.id));
  const notes = state.notes.filter((note) => pointIds.has(note.pointId));
  const seen = state.seen.filter((id) => pointIds.has(id));
  return remember({
    ...state,
    deck,
    deckError: null,
    focus: clamp(state.focus, 0, deck.points.length),
    notes,
    seen,
    optionsFocus: 0,
  });
}

export function deckFailed(state: State, message: string, now: number): State {
  return {
    ...state,
    loadingThreadId: null,
    deckError: message,
    flash: { text: message, until: now + 5_000 },
  };
}

export function backToInbox(state: State): State {
  const threadId = state.deck?.threadId;
  const items = threadId
    ? state.inbox.map((item) => item.threadId === threadId ? { ...item, draftNotes: state.notes.length } : item)
    : state.inbox;
  return {
    ...state,
    screen: "inbox",
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    deckError: null,
    inbox: items,
    inboxFocus: 0,
    focus: 0,
    recordingStartedAt: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function backToReview(state: State): State {
  return {
    ...state,
    screen: "review",
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function beginRecording(state: State, now: number): State {
  return { ...state, recordingStartedAt: now, flash: null };
}

export function endRecording(state: State): State {
  return state.recordingStartedAt === null ? state : { ...state, recordingStartedAt: null };
}

export function setFlash(state: State, text: string, now: number, ms = 4_000): State {
  return { ...state, flash: { text, until: now + ms } };
}

export function clearFlash(state: State): State {
  return state.flash ? { ...state, flash: null } : state;
}

const OBJECTION = /^(no|not|don'?t|do not|never|stop|wrong|instead)\b/i;

export function isObjection(text: string): boolean {
  return OBJECTION.test(text.trim());
}

export function applyVoice(state: State, text: string, now: number, verdict?: "object" | "note"): State {
  const point = focusedPoint(state);
  if (!point) return state;
  const decided: Note["verdict"] = point.kind === "question"
    ? "answer"
    : verdict === "object" || verdict === "note"
      ? verdict
      : isObjection(text) ? "object" : "note";
  const note: Note = { pointId: point.id, verdict: decided, text };
  const notes = [...state.notes.filter((item) => item.pointId !== point.id), note];
  return remember(setFlash({ ...state, notes, recordingStartedAt: null }, `Heard: ${text}`, now, 5_000));
}

export function chooseOption(state: State, index: number, now: number): State {
  const point = focusedPoint(state);
  const option = point?.options?.[index];
  if (!point || option === undefined) return state;
  const note: Note = { pointId: point.id, verdict: "answer", option };
  const notes = [...state.notes.filter((item) => item.pointId !== point.id), note];
  return remember(setFlash({ ...state, screen: "review", notes, optionsFocus: 0 }, `Answer: ${option}`, now, 3_000));
}

export function clearNotes(state: State, now: number): State {
  if (state.notes.length === 0) return setFlash(state, "No notes to clear", now);
  return remember(setFlash({ ...state, notes: [] }, "Notes cleared", now));
}

export function goPreview(state: State): State {
  return { ...state, screen: "preview", preview: null, previewLoading: true, sending: false, sent: false, sentAt: null, flash: null };
}

export function setPreview(state: State, preview: PreviewResult): State {
  return { ...state, preview, previewLoading: false };
}

export function previewFailed(state: State, message: string, now: number): State {
  return { ...state, preview: null, previewLoading: false, flash: { text: message, until: now + 5_000 } };
}

export function markSending(state: State): State {
  return { ...state, sending: true, flash: null };
}

export function markSent(state: State, now: number): State {
  return { ...state, sending: false, sent: true, sentAt: now, flash: null };
}

export function sendFailed(state: State, message: string, now: number): State {
  return { ...state, sending: false, flash: { text: message, until: now + 5_000 } };
}

export function finishSend(state: State): State {
  const threadId = state.deck?.threadId;
  const drafts = { ...state.drafts };
  if (threadId) delete drafts[threadId];
  // The cloud sample workspace is server-authoritative: the sample agent's
  // reply may reuse the thread id, so never hide it locally there.
  const remember = state.workspace !== "sample";
  const resolved = remember && threadId && !state.resolved.includes(threadId)
    ? [...state.resolved, threadId]
    : state.resolved;
  return {
    ...state,
    screen: "inbox",
    inbox: threadId ? state.inbox.filter((item) => item.threadId !== threadId) : state.inbox,
    inboxFocus: 0,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    deckError: null,
    notes: [],
    seen: [],
    drafts,
    resolved,
    focus: 0,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

/** Clear the local view before reloading a freshly reset sample workspace. */
export function resetWorkspace(state: State): State {
  return {
    ...state,
    screen: "inbox",
    loading: true,
    offline: false,
    offlineMessage: null,
    inbox: [],
    inboxFocus: 0,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    reviewTitle: "",
    deckError: null,
    focus: 0,
    notes: [],
    seen: [],
    drafts: {},
    resolved: [],
    recordingStartedAt: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function draftFor(state: State, now: number): ReviewDraft | null {
  const deck = state.deck;
  if (!deck) return null;
  return {
    threadId: deck.threadId,
    sourceMessageId: deck.sourceMessageId,
    notes: [...state.notes],
    seen: [...state.seen],
    updatedAt: new Date(now).toISOString(),
  };
}

export function press(state: State, now: number): PressResult {
  if (state.screen === "inbox") {
    if (state.loading || state.offline || state.inbox.length === 0) {
      return { state, effect: { type: "retry" } };
    }
    return { state, effect: { type: "open", index: state.inboxFocus } };
  }
  if (state.screen === "review") {
    if (state.recordingStartedAt !== null) {
      return { state, effect: { type: "record-stop" } };
    }
    const deck = state.deck;
    if (!deck) {
      // A 202 that outlived the wait, or a failed request: let a tap retry the
      // deck instead of leaving the review screen inert.
      return state.loadingThreadId !== null
        ? { state }
        : { state, effect: { type: "retry-deck" } };
    }
    const point = deck.points[state.focus];
    if (!point) {
      return { state: goPreview(state), effect: { type: "preview" } };
    }
    if (point.kind === "question") {
      return { state: { ...state, screen: "options", optionsFocus: 0, flash: null } };
    }
    return { state: beginRecording(state, now), effect: { type: "record-start" } };
  }
  if (state.screen === "options") {
    const point = focusedPoint(state);
    const options = point?.options ?? [];
    if (state.optionsFocus < options.length) {
      return { state: chooseOption(state, state.optionsFocus, now) };
    }
    return { state: beginRecording({ ...state, screen: "review" }, now), effect: { type: "record-start" } };
  }
  if (state.screen === "preview") {
    if (!state.preview) {
      if (state.previewLoading) return { state };
      return { state: { ...state, previewLoading: true }, effect: { type: "preview" } };
    }
    if (!canSend(state)) return { state };
    return { state: markSending(state), effect: { type: "send" } };
  }
  return { state };
}

export function doubleTap(state: State): PressResult {
  if (state.sending) return { state };
  if (state.screen === "inbox") {
    return { state, effect: { type: "exit" } };
  }
  if (state.screen === "review") {
    return { state: backToInbox(state) };
  }
  return { state: backToReview(endRecording(state)) };
}
