import type {
  AgentStatus, AppId, AskResult, Deck, EditResult, Health, InboxItem, Note, Point, PreviewResult,
  ReviewDraft, SendResult, TaskResult,
} from "../../../shared/contract";
export type ScreenName =
  | "inbox" | "review" | "options" | "preview" | "countdown" | "receipt" | "task";

/** The cloud sample workspace's story: everyday errands, coding agents, or both. */
export type SamplePersona = "everyday" | "developer" | "mixed";
export const SAMPLE_PERSONAS: readonly SamplePersona[] = ["everyday", "developer", "mixed"];
export const DEFAULT_PERSONA: SamplePersona = "mixed";

export function isSamplePersona(value: unknown): value is SamplePersona {
  return typeof value === "string" && (SAMPLE_PERSONAS as readonly string[]).includes(value);
}

/** What a hand-off by voice is doing: recording, confirming, starting, or done. */
export type TaskPhase = "recording" | "transcribing" | "confirm" | "starting" | "started" | "error";

export interface TaskNotice {
  phase: TaskPhase;
  /** What the user said, shown after "Start:". */
  text: string;
  agent?: string;
  error?: string;
  /** When the agent started, so the "Started" screen can hand back the inbox by itself. */
  startedAt?: number;
}

export interface Flash {
  text: string;
  until: number;
}

export interface SavedDraft {
  notes: Note[];
  seen: string[];
}

/** A countdown that will send a thread from the inbox without opening its deck. */
export interface PendingSend {
  threadId: string;
  title: string;
  app: AppId;
}

/** A draft sentence edit that still has to reach POST /api/edit/:threadId. */
export interface PendingEdit {
  threadId: string;
  pointId: string;
  text: string;
}

/** What the last draft edit returned, shown in the pane next to the sentence. */
export interface EditNotice {
  pointId: string;
  after?: string;
  error?: string;
}

/** A spoken question answered from the output, shown above the review until the user moves on. */
export interface AskNotice {
  question: string;
  ok: boolean;
  answer: string;
  /** Exact source sentence behind the answer, when the server found one. */
  quote?: string;
  /** The point holding that sentence, so a tap can jump to it. */
  pointId?: string;
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
  /** The paired computer, when the inbox is coming from a desk. */
  desk: { name: string; online: boolean } | null;
  serverVersion: string | null;
  inbox: InboxItem[];
  inboxFocus: number;
  /** "2 need you · 3 working · 4 done today", when the server sends it. */
  status: AgentStatus | null;
  /** Which cloud sample story the glasses ask for; only used in the sample workspace. */
  persona: SamplePersona;
  /** 'catch-up' decks are a read-only list of one-line updates ("Since you looked"). */
  reviewKind: "review" | "catch-up";
  /** The voice hand-off in progress ("New task"), or null. */
  task: TaskNotice | null;
  /** Wear status from the glasses: true on, false off, null when the host never said. */
  worn: boolean | null;
  /** Just put on: the inbox header also says what happened "Since you looked" until you open something. */
  welcome: boolean;
  deck: Deck | null;
  loadingThreadId: string | null;
  reviewThreadId: string | null;
  reviewTitle: string;
  /** Source app of the open thread, so the send row can name the destination. */
  reviewApp: AppId | null;
  deckError: string | null;
  focus: number;
  /** Routine points are hidden behind one group row until this is true. */
  routineOpen: boolean;
  notes: Note[];
  seen: string[];
  drafts: Record<string, SavedDraft>;
  /** Threads handled on this device; the demo server keeps returning them, so hide them here. */
  resolved: string[];
  recordingStartedAt: number | null;
  /** The current recording is a question for Ask, not a note about a point. */
  asking: boolean;
  /** A spoken question is on its way to POST /api/ask; the pane says "Looking...". */
  askLoading: boolean;
  /** The last answer, kept up until a tap jumps to its point or a double-tap dismisses it. */
  ask: AskNotice | null;
  optionsFocus: number;
  preview: PreviewResult | null;
  previewLoading: boolean;
  /** Undo countdown: the send happens by itself when this elapsed time is over. */
  countdownStartedAt: number | null;
  /** Set when the countdown came from an inbox row ("Agree & send"), not a deck. */
  pendingSend: PendingSend | null;
  /** Receipt lines shown for ~2 s after a send, then the inbox returns by itself. */
  receiptLines: string[];
  receiptAt: number | null;
  pendingEdit: PendingEdit | null;
  editResult: EditNotice | null;
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
  | { type: "mark-seen" }
  | { type: "task-start" }
  | { type: "open"; index: number }
  | { type: "preview" }
  | { type: "send" }
  | { type: "record-start" }
  | { type: "record-stop" }
  | { type: "retry" }
  | { type: "retry-deck" }
  /** Glasses taken off mid-recording: drop the audio and close the microphone. */
  | { type: "record-discard" }
  /** Glasses put on: reload the inbox (and its status line) without a gesture. */
  | { type: "wear-refresh" };

export const REVIEW_ROWS = 4;
export const VOICE_MAX_MS = 30_000;
export const SENT_HOLD_MS = 1_500;
/** "Started · Codex. You'll see it when it needs you." stays up this long, then the inbox returns. */
export const TASK_HOLD_MS = 2_500;
/** "Sending in 5 · Tap to undo": the only send confirmation the glasses ask for. */
export const COUNTDOWN_SECONDS = 5;
export const COUNTDOWN_MS = COUNTDOWN_SECONDS * 1_000;
/** How long the receipt stays up before the inbox returns by itself. */
export const RECEIPT_HOLD_MS = 2_000;
/** One swipe per 250 ms: the ring and touch surfaces both repeat fast. */
export const SWIPE_DEBOUNCE_MS = 250;

export function initialState(options: { demo: boolean; loading: boolean; cloud?: boolean }): State {
  return {
    screen: "inbox",
    reviewApp: null,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
    demo: options.demo,
    loading: options.loading,
    offline: false,
    offlineMessage: null,
    cloud: options.cloud ?? false,
    workspace: null,
    desk: null,
    serverVersion: null,
    inbox: [],
    inboxFocus: 0,
    status: null,
    persona: DEFAULT_PERSONA,
    reviewKind: "review",
    task: null,
    worn: null,
    welcome: false,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    reviewTitle: "",
    deckError: null,
    focus: 0,
    routineOpen: false,
    notes: [],
    seen: [],
    drafts: {},
    resolved: [],
    recordingStartedAt: null,
    asking: false,
    askLoading: false,
    ask: null,
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

/** A point needs the user's eyes when Pinpoint flagged it or marked it high risk. */
export function isFlagged(point: Point): boolean {
  return Boolean(point.flag) || point.risk === "high";
}

/**
 * The small screen only has room for what matters: a line that was flagged, marked
 * high risk, or changed since the last review needs the user; everything else is
 * routine and counts as agreed.
 */
export function needsYou(point: Point): boolean {
  return isFlagged(point) || point.changed === true || point.kind === "question";
}

/** A "Since you looked" list: one-line updates, read-only. */
export function isCatchUp(state: State): boolean {
  return state.reviewKind === "catch-up";
}

/** Routine points collapse into one group row while any point needs the user. */
export function routineGroupVisible(state: State): boolean {
  const deck = state.deck;
  if (!deck || state.routineOpen || isCatchUp(state)) return false;
  let needs = false;
  let routine = false;
  for (const point of deck.points) {
    if (needsYou(point)) needs = true;
    else routine = true;
  }
  return needs && routine;
}

/** True when the cursor is on the collapsed "routine" group row. */
export function routineGroupFocused(state: State): boolean {
  const point = focusedPoint(state);
  return routineGroupVisible(state) && point !== undefined && !needsYou(point);
}

/** The routine group row, focused, expands into its points in order. */
export function expandRoutine(state: State): State {
  const deck = state.deck;
  if (!deck || !routineGroupVisible(state)) return state;
  const first = deck.points.findIndex((point) => !needsYou(point));
  if (first < 0) return state;
  const point = deck.points[first];
  return withSeen(
    { ...state, routineOpen: true, focus: first, flash: null, editResult: null },
    point,
  );
}

/** Opening a deck starts on the first line that needs a check, else line 1. */
export function startFocus(deck: Deck): number {
  const index = deck.points.findIndex(needsYou);
  return index >= 0 ? index : 0;
}

/**
 * The next point that needs the user after `from`, skipping points they have
 * already looked at (silence means agree), or the Send row when there is none.
 */
export function nextFlaggedFocus(
  deck: Deck,
  from: number,
  seen: readonly string[] = [],
): number {
  for (let index = from + 1; index < deck.points.length; index++) {
    const point = deck.points[index];
    if (point && needsYou(point) && !seen.includes(point.id)) return index;
  }
  return deck.points.length;
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
  options: { demo: boolean; offline: boolean; status?: AgentStatus | null },
): State {
  const visible = items.filter((item) => !state.resolved.includes(item.threadId));
  const capped = visible.slice(0, 20);
  const existing = capped.some((item) => item.threadId === state.inbox[state.inboxFocus]?.threadId);
  return {
    ...state,
    inbox: [...capped],
    status: options.status ?? null,
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
  const desk = health.workspace === "desk" && health.desk
    ? { name: health.desk.name, online: health.desk.online }
    : null;
  return {
    ...state,
    cloud: health.mode === "cloud" ? true : state.cloud,
    workspace: health.workspace ?? null,
    desk,
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
    if (state.askLoading) return state;
    const deck = state.deck;
    let focus: number;
    if (routineGroupVisible(state)) {
      // Collapsed: ring past routine lines; the group row is one stop before Send.
      const order: number[] = [];
      deck.points.forEach((point, index) => {
        if (needsYou(point)) order.push(index);
      });
      const first = deck.points.findIndex((point) => !needsYou(point));
      if (first >= 0) order.push(first);
      order.push(deck.points.length);
      let position = order.indexOf(state.focus);
      if (position < 0) position = first >= 0 ? order.indexOf(first) : order.length - 1;
      focus = order[clamp(position + delta, 0, order.length - 1)] ?? state.focus;
    } else {
      const max = deck.points.length;
      focus = clamp(state.focus + delta, 0, max);
    }
    if (focus === state.focus) return state;
    // Swiping past an answer dismisses it; the review is still one screen.
    return withSeen(
      { ...state, focus, ask: null, askLoading: false, flash: null, editResult: null },
      state.deck.points[focus],
    );
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
    reviewApp: item.app ?? "t3",
    reviewKind: item.kind === "catch-up" ? "catch-up" : "review",
    task: null,
    welcome: false,
    deckError: null,
    focus: 0,
    routineOpen: false,
    notes: saved?.notes ?? [],
    seen: saved?.seen ?? [],
    recordingStartedAt: null,
    asking: false,
    askLoading: false,
    ask: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
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
  // The literal first point wins when it is a question: a question deck opens
  // straight on its answers even if a later point carries a risk flag.
  const inboxItem = state.inbox.find((item) => item.threadId === deck.threadId);
  const reviewKind: State["reviewKind"] = inboxItem?.kind === "catch-up"
    || (state.reviewThreadId === deck.threadId && state.reviewKind === "catch-up")
    ? "catch-up"
    : "review";
  // A catch-up list is read from the top; a review starts on the first line that needs you.
  const focus = reviewKind === "catch-up" || deck.points[0]?.kind === "question"
    ? 0
    : startFocus(deck);
  const point = deck.points[focus];
  const next: State = {
    ...state,
    // A question opens straight on its answer options; any other point opens
    // in the list. This is the "start where it matters" rule.
    screen: reviewKind === "review" && point?.kind === "question" ? "options" : "review",
    reviewKind,
    task: null,
    deck,
    loadingThreadId: null,
    reviewThreadId: deck.threadId,
    reviewTitle: deck.title,
    reviewApp: inboxItem?.app
      ?? (state.reviewThreadId === deck.threadId ? state.reviewApp : null)
      ?? "t3",
    deckError: null,
    focus,
    routineOpen: false,
    notes: notes.filter((note) => deck.points.some((entry) => entry.id === note.pointId)),
    seen: seen.filter((id) => deck.points.some((entry) => entry.id === id)),
    recordingStartedAt: null,
    asking: false,
    askLoading: false,
    ask: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
  return withSeen(next, point);
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
    asking: false,
    askLoading: false,
    ask: null,
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
    reviewApp: null,
    reviewKind: "review",
    task: null,
    deckError: null,
    inbox: items,
    inboxFocus: 0,
    focus: 0,
    routineOpen: false,
    recordingStartedAt: null,
    asking: false,
    askLoading: false,
    ask: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
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
    asking: false,
    askLoading: false,
    ask: null,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

export function beginRecording(state: State, now: number): State {
  return {
    ...state,
    recordingStartedAt: now,
    asking: false,
    askLoading: false,
    ask: null,
    flash: null,
    editResult: null,
  };
}

/**
 * Start recording a question for Ask. The recording itself is the same one a
 * note uses (silence stops it); only what happens to the transcript differs.
 */
export function beginAsk(state: State, now: number): State {
  if (state.screen !== "review" || !state.deck) return state;
  return {
    ...state,
    recordingStartedAt: now,
    asking: true,
    askLoading: false,
    ask: null,
    flash: null,
    editResult: null,
  };
}

/** The question was spoken; the server is looking for its sentence. */
export function beginAskLoading(state: State): State {
  if (!state.asking) return state;
  return { ...state, asking: false, askLoading: true, ask: null, flash: null };
}

/** Show the server's answer, with the source sentence and the point to jump to. */
export function applyAsk(state: State, question: string, result: AskResult): State {
  return {
    ...state,
    asking: false,
    askLoading: false,
    ask: {
      question,
      ok: result.ok,
      answer: result.answer || "Not in this output.",
      ...(result.quote ? { quote: result.quote } : {}),
      ...(result.pointId ? { pointId: result.pointId } : {}),
    },
    flash: null,
  };
}

/** The question failed on the way to the server; the review stays where it was. */
export function askFailed(state: State, message: string, now: number): State {
  return {
    ...state,
    asking: false,
    askLoading: false,
    ask: null,
    flash: { text: message, until: now + 5_000 },
  };
}

/** Tap on an answer jumps to the sentence's point, expanding routine rows if needed. */
export function jumpToAsk(state: State): State {
  const ask = state.ask;
  const deck = state.deck;
  if (!ask || !deck) return dismissAsk(state);
  const index = ask.pointId
    ? deck.points.findIndex((point) => point.id === ask.pointId)
    : -1;
  const cleared = dismissAsk(state);
  if (index < 0) return cleared;
  const point = deck.points[index]!;
  return withSeen(
    {
      ...cleared,
      focus: index,
      routineOpen: state.routineOpen || !needsYou(point),
      flash: null,
      editResult: null,
    },
    point,
  );
}

/** Double-tap on an answer returns to the open review, with no jump. */
export function dismissAsk(state: State): State {
  return { ...state, asking: false, askLoading: false, ask: null };
}

export function endRecording(state: State): State {
  return state.recordingStartedAt === null ? state : { ...state, recordingStartedAt: null };
}

/**
 * A foreground change (phone locked, exit dialog, menu overlay, return to the
 * app) cancels any recording in progress. The microphone is never re-armed
 * here; the user starts a fresh note with a tap.
 */
export function recordingOnSurface(state: State): { state: State; discard: boolean } {
  if (state.recordingStartedAt === null) return { state, discard: false };
  const dropped: State = { ...state, recordingStartedAt: null, asking: false };
  return {
    state: state.task?.phase === "recording" ? cancelTask(dropped) : dropped,
    discard: true,
  };
}

/** The microphone could not open: nothing was recorded, so nothing stays half-started. */
export function recordingFailed(state: State, message: string, now: number): State {
  const ended: State = { ...state, recordingStartedAt: null, asking: false };
  const cleared = state.task?.phase === "recording" ? cancelTask(ended) : ended;
  return setFlash(cleared, message, now);
}

// ---- Wear detection ------------------------------------------------------------------------

/**
 * The glasses report on/off the head (DeviceStatus.isWearing).
 *   Taken off mid-recording: the recording is dropped and the microphone closed, nothing is sent.
 *   Put on again: land on the inbox with the status line and "Since you looked" and reload it, with
 *   no gesture. A send already counting down is never interrupted; drafts stay saved.
 */
export function wearChanged(state: State, worn: boolean): PressResult {
  if (state.worn === worn) return { state };
  const known = state.worn !== null;
  const next: State = { ...state, worn };
  if (!worn) {
    if (next.recordingStartedAt === null) return { state: next };
    const { state: dropped } = recordingOnSurface(next);
    return { state: { ...dropped, flash: null }, effect: { type: "record-discard" } };
  }
  const busy = next.sending || next.screen === "countdown" || next.screen === "receipt";
  if (busy) return { state: next, effect: { type: "wear-refresh" } };
  // The very first report only says where the glasses already are: nothing to catch up on.
  if (!known && next.screen !== "inbox") return { state: next };
  // The page is rebuilt, which resets the native list to its first row: so does the cursor.
  const home = next.screen === "inbox" ? { ...next, inboxFocus: 0 } : { ...backToInbox(next), worn: true };
  return { state: { ...home, welcome: true }, effect: { type: "wear-refresh" } };
}

// ---- New task: hand a job to an agent by voice ------------------------------------------

/** Hold menu -> "New task": the next thing you say is the request. */
export function beginTask(state: State, now: number): State {
  if (state.screen !== "inbox" || state.loading || state.sending) return state;
  return {
    ...state,
    screen: "task",
    welcome: false,
    task: { phase: "recording", text: "" },
    recordingStartedAt: now,
    flash: null,
  };
}

/** The request was spoken and is being turned into text. */
export function beginTaskTranscribing(state: State): State {
  if (state.task?.phase !== "recording") return state;
  return { ...state, recordingStartedAt: null, task: { phase: "transcribing", text: "" } };
}

/** The words arrived: show them for one confirming tap. Silence returns to the inbox. */
export function taskHeard(state: State, text: string, now: number): State {
  if (state.task?.phase !== "transcribing") return state;
  const clean = text.trim();
  if (!clean) return setFlash(cancelTask(state), "Didn't catch that. Try again.", now);
  return { ...state, task: { phase: "confirm", text: clean } };
}

export function beginTaskStart(state: State): State {
  if (state.task?.phase !== "confirm") return state;
  return { ...state, task: { ...state.task, phase: "starting" } };
}

/** POST /api/task answered: say which agent took it, or why not. */
export function applyTask(state: State, result: TaskResult, now: number): State {
  if (state.task?.phase !== "starting") return state;
  if (!result.ok) {
    return {
      ...state,
      task: {
        ...state.task,
        phase: "error",
        error: result.error ?? "Couldn't start it. Try again.",
      },
    };
  }
  return {
    ...state,
    task: { ...state.task, phase: "started", agent: result.agent ?? "Agent", startedAt: now },
  };
}

export function taskFailed(state: State, message: string): State {
  if (state.task?.phase !== "starting") return state;
  return { ...state, task: { ...state.task, phase: "error", error: message } };
}

/** Back to the inbox with nothing started. */
export function cancelTask(state: State): State {
  return { ...state, screen: "inbox", task: null, recordingStartedAt: null, flash: null };
}

export function taskDue(state: State, now: number): boolean {
  return state.screen === "task" && state.task?.phase === "started"
    && state.task.startedAt !== undefined && now - state.task.startedAt >= TASK_HOLD_MS;
}

// ---- Catch-up ("Since you looked") ---------------------------------------------------------

/** A hand-off from an inbox row: mark a catch-up list seen without opening it. */
export function startMarkSeen(state: State, item: InboxItem): State {
  if (state.sending) return state;
  return {
    ...state,
    sending: true,
    pendingSend: { threadId: item.threadId, title: item.title, app: item.app ?? "t3" },
    flash: null,
  };
}

/** Show the recording clock at most once per second. */
export function recordingTickDelay(now: number, startedAt: number): number {
  const elapsed = now - startedAt;
  if (elapsed >= VOICE_MAX_MS) return 0;
  return Math.min(1_000 - (elapsed % 1_000) + 30, VOICE_MAX_MS - elapsed);
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

/**
 * Move to the next line that needs a check, or to the Send row. A voice note
 * leaves the send tap for the user (so a just-edited draft sentence can be
 * read); choosing the last answer starts the undo countdown instead, because
 * the answer is the whole decision and the countdown is its confirmation.
 */
function advanceAfterNote(state: State, autoSend: boolean, now: number): State {
  const deck = state.deck;
  if (!deck) return state;
  // Skip lines already looked at: the user moved past them, so silence agreed.
  const focus = nextFlaggedFocus(deck, state.focus, state.seen);
  const advanced = withSeen(
    { ...state, focus, asking: false, flash: null },
    deck.points[focus],
  );
  if (autoSend && focus >= deck.points.length) return startCountdown(advanced, now);
  return advanced;
}

export function applyVoice(state: State, text: string, now: number, verdict?: "object" | "note"): State {
  const point = focusedPoint(state);
  const deck = state.deck;
  if (!point || !deck || state.asking) return state;
  const decided: Note["verdict"] = point.kind === "question"
    ? "answer"
    : verdict === "object" || verdict === "note"
      ? verdict
      : isObjection(text) ? "object" : "note";
  const note: Note = { pointId: point.id, verdict: decided, text };
  const notes = [...state.notes.filter((item) => item.pointId !== point.id), note];
  const pendingEdit: PendingEdit | null = point.kind === "draft" && text.trim().length > 0
    ? { threadId: deck.threadId, pointId: point.id, text }
    : null;
  const next = remember({
    ...state,
    notes,
    recordingStartedAt: null,
    flash: null,
    editResult: null,
    pendingEdit,
  });
  return advanceAfterNote(next, false, now);
}

export function chooseOption(state: State, index: number, now: number): State {
  const point = focusedPoint(state);
  const option = point?.options?.[index];
  if (!point || option === undefined) return state;
  const note: Note = { pointId: point.id, verdict: "answer", option };
  const notes = [...state.notes.filter((item) => item.pointId !== point.id), note];
  const next = remember({
    ...state,
    screen: "review",
    notes,
    optionsFocus: 0,
    flash: null,
    editResult: null,
    pendingEdit: null,
  });
  return advanceAfterNote(next, true, now);
}

/** Start the 5 s "Sending… tap to undo" countdown for the open deck. */
export function startCountdown(state: State, now: number): State {
  if (!state.deck || state.sending) return state;
  return {
    ...state,
    screen: "countdown",
    focus: state.deck.points.length,
    countdownStartedAt: now,
    pendingSend: null,
    asking: false,
    askLoading: false,
    ask: null,
    flash: null,
  };
}

/** "Agree & send" from an inbox row: send without opening the deck. */
export function startInboxCountdown(state: State, item: InboxItem, now: number): State {
  if (state.sending) return state;
  return {
    ...state,
    screen: "countdown",
    countdownStartedAt: now,
    pendingSend: { threadId: item.threadId, title: item.title, app: item.app ?? "t3" },
    focus: 0,
    optionsFocus: 0,
    asking: false,
    askLoading: false,
    ask: null,
    pendingEdit: null,
    editResult: null,
    flash: null,
  };
}

/** Seconds left in the countdown, 5 at the start and 0 when it is due. */
export function countdownLeft(state: State, now: number): number {
  if (state.countdownStartedAt === null) return 0;
  const left = COUNTDOWN_MS - (now - state.countdownStartedAt);
  return Math.max(0, Math.ceil(left / 1_000));
}

export function countdownDue(state: State, now: number): boolean {
  return state.screen === "countdown" && state.countdownStartedAt !== null
    && now - state.countdownStartedAt >= COUNTDOWN_MS;
}

/** Tap during the countdown cancels it: back to the review (or the inbox). */
export function cancelCountdown(state: State): State {
  if (state.screen !== "countdown") return state;
  return {
    ...state,
    screen: state.deck ? "review" : "inbox",
    countdownStartedAt: null,
    pendingSend: null,
    sending: false,
    flash: null,
  };
}

/** The receipt stage: lines from SendResult.receipt, or one calm sentence. */
export function showReceipt(state: State, result: SendResult, now: number): State {
  const lines = result.receipt?.lines.map((line) => line.text) ?? [];
  return {
    ...state,
    screen: "receipt",
    sending: false,
    sent: true,
    sentAt: now,
    receiptLines: lines.length > 0 ? lines : ["Sent to the agent."],
    receiptAt: now,
    countdownStartedAt: null,
    pendingEdit: null,
  };
}

export function receiptDue(state: State, now: number): boolean {
  return state.screen === "receipt" && state.receiptAt !== null
    && now - state.receiptAt >= RECEIPT_HOLD_MS;
}

/**
 * Apply the server's answer for a spoken draft edit. The note itself is never
 * dropped: a failed edit leaves it in place and shows the short error instead.
 */
export function applyEdit(state: State, result: EditResult): State {
  const notice: EditNotice = result.ok
    ? { pointId: result.pointId, after: result.after }
    : { pointId: result.pointId, error: result.error ?? "Couldn't change this line" };
  // A deleted sentence has no replacement text; the empty string still marks
  // the row CHANGED and reads as "line removed" in the pane.
  const notes = result.ok
    ? state.notes.map((note) => note.pointId === result.pointId
      ? { ...note, after: result.after ?? "" }
      : note)
    : state.notes;
  return remember({
    ...state,
    notes,
    pendingEdit: null,
    editResult: notice,
  });
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
  // A failed countdown returns to the review so the send row is one tap away;
  // never leave the user staring at a finished countdown.
  const fromCountdown = state.screen === "countdown";
  return {
    ...state,
    screen: fromCountdown ? (state.deck ? "review" : "inbox") : state.screen,
    countdownStartedAt: fromCountdown ? null : state.countdownStartedAt,
    pendingSend: fromCountdown ? null : state.pendingSend,
    sending: false,
    flash: { text: message, until: now + 5_000 },
  };
}

export function finishSend(state: State): State {
  const threadId = state.deck?.threadId ?? state.pendingSend?.threadId ?? null;
  const removedAt = threadId ? state.inbox.findIndex((item) => item.threadId === threadId) : -1;
  const inbox = threadId ? state.inbox.filter((item) => item.threadId !== threadId) : state.inbox;
  // The cursor lands on the next item that needs you, with no extra gesture.
  const inboxFocus = removedAt >= 0 ? Math.min(removedAt, Math.max(0, inbox.length - 1)) : state.inboxFocus;
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
    inbox,
    inboxFocus,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    reviewApp: null,
    reviewKind: "review",
    task: null,
    deckError: null,
    notes: [],
    seen: [],
    drafts,
    resolved,
    focus: 0,
    routineOpen: false,
    optionsFocus: 0,
    asking: false,
    askLoading: false,
    ask: null,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
    sending: false,
    sent: false,
    sentAt: null,
    flash: null,
  };
}

/** The sample story changed: start from an empty view and reload the inbox. */
export function setPersona(state: State, persona: SamplePersona): State {
  return resetWorkspace({ ...state, persona });
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
    status: null,
    reviewKind: "review",
    task: null,
    deck: null,
    loadingThreadId: null,
    reviewThreadId: null,
    reviewTitle: "",
    reviewApp: null,
    deckError: null,
    focus: 0,
    routineOpen: false,
    notes: [],
    seen: [],
    drafts: {},
    resolved: [],
    recordingStartedAt: null,
    asking: false,
    askLoading: false,
    ask: null,
    optionsFocus: 0,
    preview: null,
    previewLoading: false,
    countdownStartedAt: null,
    pendingSend: null,
    receiptLines: [],
    receiptAt: null,
    pendingEdit: null,
    editResult: null,
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

/**
 * Tap. `listIndex` is the native list row that was actually tapped. A list
 * click may omit the index for the first row (documented host behaviour), so
 * callers pass 0 in that case; this function then opens the row the user sees
 * highlighted instead of a stale `inboxFocus` from an earlier swipe.
 */
export function press(state: State, now: number, listIndex?: number): PressResult {
  if (state.screen === "inbox") {
    if (state.loading || state.offline || state.inbox.length === 0) {
      return { state, effect: { type: "retry" } };
    }
    const index = clamp(listIndex ?? state.inboxFocus, 0, state.inbox.length - 1);
    return { state: index === state.inboxFocus ? state : setInboxFocus(state, index), effect: { type: "open", index } };
  }
  if (state.screen === "task") {
    const task = state.task;
    if (!task) return { state: cancelTask(state) };
    switch (task.phase) {
      case "recording":
        return { state, effect: { type: "record-stop" } };
      case "confirm":
        return { state: beginTaskStart(state), effect: { type: "task-start" } };
      case "error":
        // Back to the confirm line: one more tap tries again.
        return { state: { ...state, task: { ...task, phase: "confirm", error: undefined } } };
      case "started":
        return { state: cancelTask(state) };
      default:
        return { state };
    }
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
    if (isCatchUp(state)) return pressCatchUp(state, deck, now);
    if (state.askLoading) return { state };
    if (state.ask) return { state: jumpToAsk(state) };
    const point = deck.points[state.focus];
    if (!point) {
      // The Send row starts the undo countdown, never a preview screen.
      return { state: startCountdown(state, now) };
    }
    if (routineGroupFocused(state)) {
      // The routine row opens in place; the cursor stays on its first point.
      return { state: expandRoutine(state) };
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
  if (state.screen === "countdown") {
    if (state.sending) return { state };
    return { state: cancelCountdown(state) };
  }
  if (state.screen === "receipt") {
    return { state: finishSend(state) };
  }
  if (state.screen === "preview") {
    if (state.sending || state.sent) return { state };
    if (state.preview || state.previewLoading) return { state: backToReview(state) };
    return { state: { ...state, previewLoading: true }, effect: { type: "preview" } };
  }
  return { state };
}

/**
 * "Since you looked" is read-only. A tap on a line that points at a thread you can open
 * opens it; a tap on the last row ("Mark seen") clears the list in one tap.
 */
function pressCatchUp(state: State, deck: Deck, now: number): PressResult {
  if (state.sending) return { state };
  const point = deck.points[state.focus];
  if (!point) return { state: { ...state, sending: true, flash: null }, effect: { type: "mark-seen" } };
  if (!point.threadRef) return { state };
  const index = state.inbox.findIndex(
    (item) => item.threadId === point.threadRef && item.kind !== "catch-up",
  );
  if (index < 0) return { state: setFlash(state, "Already handled", now, 3_000) };
  return { state, effect: { type: "open", index } };
}

export function doubleTap(state: State): PressResult {
  if (state.sending) return { state };
  if (state.screen === "inbox") {
    return { state, effect: { type: "exit" } };
  }
  if (state.screen === "task") {
    const task = state.task;
    // The agent is already starting; there is nothing left to cancel.
    if (task?.phase === "starting") return { state };
    return { state: cancelTask(state) };
  }
  if (state.screen === "review") {
    // An answer or a question recording is a small overlay on the review:
    // double-tap closes it and leaves the review open, never the inbox.
    if (state.ask || state.askLoading || state.asking) {
      return { state: dismissAsk(endRecording(state)) };
    }
    return { state: backToInbox(state) };
  }
  if (state.screen === "countdown") {
    return { state: cancelCountdown(state) };
  }
  if (state.screen === "receipt") {
    return { state: finishSend(state) };
  }
  if (state.screen === "preview") {
    // Sending is the deliberate action on the preview: a double tap, as the
    // pane says. A single tap backs out.
    if (!canSend(state)) return { state };
    return { state: markSending(state), effect: { type: "send" } };
  }
  return { state: backToReview(endRecording(state)) };
}
