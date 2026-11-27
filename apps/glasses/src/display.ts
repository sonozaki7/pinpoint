import {
  APP_TAG, type AgentStatus, type AppId, type InboxItem, type Point,
} from "../../../shared/contract";
import {
  countdownLeft, countNotes, focusedPoint, isCatchUp, needsYou, noteFor, REVIEW_ROWS,
  routineGroupFocused, routineGroupVisible, SAMPLE_PERSONAS, type AskNotice, type SamplePersona,
  type State, type TaskNotice,
} from "./model";
import {
  HEADER_MAX_PX, LIST_ITEM_MAX_PX, LIST_MAX_CHARS, PANE_MAX_PX, PREVIEW_MAX_PX,
  ROW_MAX_CHARS, ROW_MAX_PX, pxTruncate, textWidth, wrapText,
} from "./textfit";

/** The separator between two ideas on one line. Present in the G2 font (U+00B7). */
export const DOT = " · ";
/**
 * Character caps are only a safety net. The real limit is the measured pixel
 * width of the container; see `textfit.ts`.
 */
export const ROW_WIDTH = ROW_MAX_CHARS;
export const LIST_WIDTH = LIST_MAX_CHARS;
export const PANE_WIDTH = ROW_MAX_CHARS;

export interface MenuEntry {
  id: number;
  label: string;
}

export interface PageRow {
  text: string;
  brightness: number;
}

export interface PageModel {
  kind: State["screen"];
  title: string;
  subtitle?: string;
  list?: string[];
  listFocus?: number;
  message?: string;
  rows: PageRow[];
  pane?: string;
  footer: string;
  menu: MenuEntry[];
}

const REPLACEMENTS: Record<string, string> = {
  "—": "-", "–": "-", "·": "·", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'",
  "→": "->", "←": "<-", "✓": "+", "✗": "x", "●": "*", "○": "o", "▶": ">", "•": "-",
  "≥": ">=", "≤": "<=", "\u00a0": " ", "\u2028": " ", "\u2029": " ",
};

/**
 * The glasses have one font; keep every string inside the glyphs it has. The
 * middle dot is in the firmware table (U+00B7, 5 px); anything else outside
 * printable ASCII becomes a plain-word substitute or a space.
 */
export function toAscii(value: string): string {
  const plain = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const chars = Array.from(plain).map((char) => {
    if (char === "\n" || char === "\t") return " ";
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) return char;
    return REPLACEMENTS[char] ?? " ";
  });
  return chars.join("").replace(/[ \t]+/g, " ").trim();
}

/** Prefer cutting at a word boundary so a row ends with a word, not "sal...". */
function wordSafeEllipsis(text: string): string {
  if (!text.endsWith("...")) return text;
  const body = text.slice(0, -3);
  const space = body.lastIndexOf(" ");
  if (space > 0 && body.length - space <= 12) {
    return `${body.slice(0, space).trimEnd()}...`;
  }
  return text;
}

/** Fit already-normalised text to a pixel budget and a fallback character cap. */
function fitLine(text: string, maxPx: number, maxChars: number): string {
  if (text.length <= maxChars && textWidth(text) <= maxPx) return text;
  const capped = text.length > maxChars
    ? `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
    : text;
  return wordSafeEllipsis(pxTruncate(capped, maxPx));
}

/** Single-line ASCII label, fitted by pixels instead of a fixed character count. */
export function asciiTruncate(
  value: string,
  max = ROW_WIDTH,
  maxPx = ROW_MAX_PX,
): string {
  return fitLine(toAscii(value), maxPx, max);
}

/** Word-wrap into at most `lines` lines, fitted by pixel width. */
export function wrapAscii(
  value: string,
  width = PANE_WIDTH,
  lines = 3,
  maxPx = PANE_MAX_PX,
): string {
  return wrapText(toAscii(value), maxPx, lines, width);
}

/**
 * Like wrapAscii, but a "\n" in the text starts a new line (a new paragraph), so a short
 * message can say two things on two lines. Later paragraphs get what the earlier ones leave.
 */
export function wrapParagraphs(
  value: string,
  lines = 3,
  maxPx = PANE_MAX_PX,
  width = PANE_WIDTH,
): string {
  const paragraphs = value.split("\n").map(toAscii).filter((part) => part.length > 0);
  const out: string[] = [];
  paragraphs.forEach((part, index) => {
    const left = lines - out.length - (paragraphs.length - index - 1);
    if (left <= 0) return;
    out.push(...wrapText(part, maxPx, Math.max(1, left), width).split("\n"));
  });
  return out.slice(0, lines).join("\n");
}

/**
 * The old per-row marker helper is kept for callers that still import it.
 * Review rows no longer use glyphs: the words CHANGE, NOTE, CHECK and the
 * chosen answer carry the state.
 */
export function markerFor(point: Point, state: State): string {
  const note = noteFor(state, point.id);
  if (note) {
    if (note.verdict === "object") return "x";
    if (note.verdict === "note") return "*";
    return "=";
  }
  if (point.kind === "question") return "?";
  return state.seen.includes(point.id) ? "+" : "o";
}

/** Prefix a row with the cursor, keeping the indent out of the pixel trim. */
function cursorRow(text: string, focused: boolean, max = ROW_WIDTH): string {
  // Three spaces equal the 15 px of "> " so the row text stays aligned.
  const prefix = focused ? "> " : "   ";
  return `${prefix}${asciiTruncate(text, Math.max(1, max - 2), ROW_MAX_PX - 20)}`;
}

/** Right-align a closing word, padding with real spaces measured in pixels. */
function rightLabel(text: string, label: string, maxPx = ROW_MAX_PX): string {
  if (!label) return fitLine(text, maxPx, ROW_WIDTH);
  const cleanLabel = asciiTruncate(label, 32, Math.floor(maxPx * 0.45));
  const body = fitLine(text, maxPx - textWidth(cleanLabel) - 5, ROW_WIDTH);
  let spaces = Math.max(1, Math.floor((maxPx - textWidth(body) - textWidth(cleanLabel)) / 5));
  let out = `${body}${" ".repeat(spaces)}${cleanLabel}`;
  while (spaces > 1 && textWidth(out) > maxPx) {
    spaces--;
    out = `${body}${" ".repeat(spaces)}${cleanLabel}`;
  }
  return textWidth(out) <= maxPx ? out : `${body} ${cleanLabel}`;
}

/** The closing word for a row: a change, a note, a flag, or a chosen option. */
function rowLabel(point: Point, state: State): string {
  if (isCatchUp(state)) return catchUpTarget(point, state) ? "OPEN" : "";
  const note = noteFor(state, point.id);
  if (note) {
    // A draft sentence that came back changed reads as CHANGED, not CHANGE.
    if (note.after !== undefined) return "CHANGED";
    if (note.verdict === "object") return "CHANGE";
    if (note.verdict === "note") return "NOTE";
    return note.option ?? "ANSWER";
  }
  if (point.risk === "high" || point.flag) return "CHECK";
  if (point.changed) return "CHANGED";
  return "";
}

/** The inbox thread a "Since you looked" line opens, when that thread still needs you. */
export function catchUpTarget(point: Point, state: State): InboxItem | undefined {
  if (!point.threadRef) return undefined;
  return state.inbox.find((item) => item.threadId === point.threadRef && item.kind !== "catch-up");
}

/**
 * Brightness is importance (text brightness runs 0-4 per text container):
 *   4  needs you (flagged, high risk, changed, a question) and the Send row under the cursor
 *   3  a line you already answered or noted
 *   2  routine, under the cursor
 *   1  routine, anywhere else
 * The cursor itself is the "> " marker, so a routine line never shines just because it is selected.
 */
export const BRIGHTNESS = { needsYou: 4, handled: 3, routineFocused: 2, routine: 1, send: 2 } as const;

export function pointBrightness(point: Point, state: State, focused: boolean): number {
  if (isCatchUp(state)) return focused ? 4 : 3;
  if (noteFor(state, point.id)) return BRIGHTNESS.handled;
  if (needsYou(point)) return BRIGHTNESS.needsYou;
  return focused ? BRIGHTNESS.routineFocused : BRIGHTNESS.routine;
}

/** `> 4 Sign out every customer once ... CHECK` — one idea, words at the end. */
export function pointRow(point: Point, state: State, focused = false): string {
  const prefix = focused ? "> " : "   ";
  return rightLabel(`${prefix}${point.index} ${toAscii(point.glance)}`, rowLabel(point, state));
}

export interface RowSlot {
  kind: "point";
  point: Point;
  focused: boolean;
}

export interface SendSlot {
  kind: "send";
  count: number;
  focused: boolean;
}

/** The one row that hides every routine point until it is tapped open. */
export interface RoutineSlot {
  kind: "routine";
  count: number;
  focused: boolean;
  expanded: boolean;
}

export type Slot = RowSlot | SendSlot | RoutineSlot;

export function reviewSlots(state: State): Slot[] {
  const deck = state.deck;
  if (!deck) return [];
  const items: Slot[] = [];
  if (routineGroupVisible(state)) {
    // Only the lines that need you stay on screen; everything else is one row.
    deck.points.forEach((point, index) => {
      if (needsYou(point)) items.push({ kind: "point", point, focused: index === state.focus });
    });
    const count = deck.points.filter((point) => !needsYou(point)).length;
    items.push({
      kind: "routine",
      count,
      focused: routineGroupFocused(state),
      expanded: false,
    });
  } else {
    deck.points.forEach((point, index) => {
      items.push({ kind: "point", point, focused: index === state.focus });
    });
  }
  items.push({ kind: "send", count: state.notes.length, focused: state.focus === deck.points.length });
  const rows = Math.min(REVIEW_ROWS, items.length);
  // In the collapsed list the focused group row sits after the needs-you rows,
  // so its visible position is not the point index. Window around the row.
  const focusedIndex = Math.max(0, items.findIndex((slot) => slot.focused));
  const start = Math.min(
    Math.max(0, focusedIndex - (rows - 1)),
    Math.max(0, items.length - rows),
  );
  return items.slice(start, start + rows);
}

/**
 * `<title>  <summary>`, or `Mail  <title>  <summary>` when the inbox mixes
 * apps. The tag is only useful when more than one source is present.
 */
export function inboxRow(item: InboxItem, showAppTag = false): string {
  const tag = showAppTag ? `${APP_TAG[item.app ?? "t3"]}  ` : "";
  const title = toAscii(item.title);
  const summary = toAscii(item.summary);
  return fitLine(`${tag}${title}  ${summary}`, LIST_ITEM_MAX_PX, LIST_WIDTH);
}

/** True when the inbox holds work from more than one app. */
export function mixedApps(items: readonly InboxItem[]): boolean {
  return new Set(items.map((item) => item.app ?? "t3")).size > 1;
}

/** Fit a title plus suffix into the header, shortening the title first. */
export function fitTitle(
  title: string,
  suffix: string,
  max = ROW_WIDTH,
  maxPx = HEADER_MAX_PX,
): string {
  const cleanTitle = toAscii(title);
  // Keep an intentional leading space (the " · " separator) even though
  // toAscii trims the raw string.
  const spaced = suffix.startsWith(" ");
  const cleanSuffix = asciiTruncate(suffix, ROW_WIDTH, maxPx);
  const suffixText = spaced && !cleanSuffix.startsWith(" ") ? ` ${cleanSuffix}` : cleanSuffix;
  const full = `${cleanTitle}${suffixText}`;
  if (full.length <= max && textWidth(full) <= maxPx) return full;
  const room = maxPx - textWidth(suffixText);
  if (room >= 24) {
    const fittedTitle = fitLine(cleanTitle, room, Math.max(1, max - suffixText.length));
    const fitted = `${fittedTitle}${suffixText}`;
    if (fitted.length <= max && textWidth(fitted) <= maxPx) return fitted;
  }
  return fitLine(full, maxPx, max);
}

/**
 * `login-fix · 4 of 7 · 1 change · 1 note` — words, no jargon, no counters
 * that need a legend. Objections and answers count as changes.
 */
export function reviewHeader(state: State): string {
  const deck = state.deck;
  if (!deck) return asciiTruncate(state.reviewTitle || "Review", ROW_WIDTH, HEADER_MAX_PX);
  if (isCatchUp(state)) {
    const total = deck.points.length;
    return fitTitle(deck.title, `${DOT}${total} update${total === 1 ? "" : "s"}`);
  }
  const position = Math.min(state.focus + 1, deck.points.length);
  const counts = countNotes(state.notes);
  const changes = counts.objections + counts.answers;
  // Collapsed, the list is only what needs you, so say that instead of "4 of 7".
  const needs = deck.points.filter(needsYou).length;
  const parts = routineGroupVisible(state)
    ? [`${needs} need${needs === 1 ? "s" : ""} you`]
    : [`${position} of ${deck.points.length}`];
  if (changes > 0) parts.push(`${changes} change${changes === 1 ? "" : "s"}`);
  if (counts.notes > 0) parts.push(`${counts.notes} note${counts.notes === 1 ? "" : "s"}`);
  return fitTitle(deck.title, `${DOT}${parts.join(DOT)}`);
}

function optionLines(point: Point): string {
  const options = point.options ?? [];
  if (options.length === 0) return wrapAscii(`"${point.quote}"`);
  return options
    .slice(0, 3)
    .map((option, index) => `${index + 1} ${asciiTruncate(option, PANE_WIDTH, PANE_MAX_PX - 20)}`)
    .join("\n");
}

/** "A: <answer>" over up to two lines, then the source sentence on one line. */
function askLines(ask: AskNotice): string {
  const answer = wrapAscii(`A: ${ask.answer}`, PANE_WIDTH, 2, PANE_MAX_PX);
  if (!ask.quote) return answer;
  const source = asciiTruncate(`From: "${ask.quote}"`, PANE_WIDTH, PANE_MAX_PX);
  return `${answer}\n${source}`;
}

/** The quote, then the one line of evidence that made this point worth a look. */
function pointDetail(point: Point): string {
  const reason = point.why || point.flag;
  const extra = reason
    ? `Why: ${reason}`
    : point.changed
      ? "Changed since your review"
      : "";
  const quote = wrapAscii(`"${point.quote}"`, PANE_WIDTH, extra ? 2 : 3, PANE_MAX_PX);
  return extra ? `${quote}\n${asciiTruncate(extra, PANE_WIDTH, PANE_MAX_PX)}` : quote;
}

/** One line per update; the focused update's sentence, or what the tap will do. */
function catchUpPane(state: State): string {
  const deck = state.deck;
  if (!deck) return "Building points...";
  const point = deck.points[state.focus];
  if (!point) return wrapParagraphs("That's everything.\nTap to mark it seen.");
  const target = catchUpTarget(point, state);
  const quote = wrapAscii(point.quote, PANE_WIDTH, target ? 2 : 3, PANE_MAX_PX);
  return target
    ? `${quote}\n${asciiTruncate(`Opens ${target.title}`, PANE_WIDTH, PANE_MAX_PX)}`
    : quote;
}

function reviewPane(state: State, now: number): string {
  if (state.recordingStartedAt !== null) {
    const seconds = Math.max(0, Math.floor((now - state.recordingStartedAt) / 1000));
    return state.asking
      ? `Ask your question${DOT}${seconds}s\nTap to stop`
      : `Recording ${seconds}s${DOT}tap to stop`;
  }
  if (state.askLoading) return wrapAscii("Looking…");
  if (state.ask) return askLines(state.ask);
  if (state.flash && state.flash.until > now) return wrapAscii(state.flash.text);
  if (isCatchUp(state)) return catchUpPane(state);
  // The applied draft sentence stays visible even after the focus moved on, so
  // the user reads the new wording before the send countdown starts.
  if (state.editResult) {
    return state.editResult.error
      ? wrapAscii(state.editResult.error)
      : wrapAscii(`Now: ${state.editResult.after ?? "line removed"}`);
  }
  const deck = state.deck;
  if (!deck) {
    return state.deckError
      ? wrapParagraphs(`${state.deckError}\nTap to retry.`)
      : "Building points...";
  }
  if (routineGroupFocused(state)) {
    const count = deck.points.filter((point) => !needsYou(point)).length;
    return wrapParagraphs(
      `${count} routine point${count === 1 ? "" : "s"}${DOT}all agreed.\nTap to read them.`,
    );
  }
  const point = deck.points[state.focus];
  if (!point) {
    const last = state.notes[state.notes.length - 1];
    if (last?.after !== undefined) return wrapAscii(`Now: ${last.after || "line removed"}`);
    if (last?.option) return wrapAscii(`You chose: ${last.option}`);
    if (last?.text) return wrapAscii(`You said: ${last.text}`);
    return wrapAscii(`Send your review to ${deck.title}.`);
  }
  const note = noteFor(state, point.id);
  if (note) {
    if (note.after !== undefined) return wrapAscii(`Now: ${note.after || "line removed"}`);
    if (note.option) return wrapAscii(`You chose: ${note.option}`);
    if (note.text) return wrapAscii(`You said: ${note.text}`);
  }
  if (point.kind === "question") return optionLines(point);
  if (needsYou(point)) return pointDetail(point);
  return wrapAscii(`"${point.quote}"`);
}

function reviewFooter(state: State): string {
  if (state.recordingStartedAt !== null) return `Tap: stop${DOT}Double-tap: back`;
  if (state.askLoading) return "Double-tap: back";
  if (state.ask) {
    return state.ask.pointId
      ? `Tap: go to line${DOT}Double-tap: back`
      : `Tap: close${DOT}Double-tap: back`;
  }
  if (!state.deck) return state.deckError ? `Tap: retry${DOT}Double-tap: back` : "Double-tap: back";
  if (isCatchUp(state)) {
    const line = state.deck.points[state.focus];
    if (!line) return `Tap: mark seen${DOT}Double-tap: back`;
    return catchUpTarget(line, state)
      ? `Tap: open${DOT}Double-tap: back`
      : "Double-tap: back";
  }
  if (routineGroupFocused(state)) return `Tap: expand${DOT}Double-tap: back`;
  const point = state.deck.points[state.focus];
  if (!point) return `Tap: send${DOT}Double-tap: back`;
  if (point.kind === "question") return `Tap: answer${DOT}Double-tap: back`;
  if (point.kind === "draft") return `Tap: fix${DOT}Double-tap: back`;
  return `Tap: talk${DOT}Double-tap: back`;
}

/** Hold-menu ids. Existing ids keep their meaning; new ones only append. */
export const MENU = {
  refresh: 4,
  reset: 5,
  agree: 6,
  ask: 7,
  newTask: 8,
  markSeen: 9,
  everyday: 10,
  developer: 11,
  mixed: 12,
} as const;

const PERSONA_LABEL: Record<SamplePersona, string> = {
  everyday: "Everyday",
  developer: "Developer",
  mixed: "Mixed",
};

/** menu id -> persona, for the three "Sample: ..." entries. */
export function personaForMenu(id: number): SamplePersona | null {
  if (id === MENU.everyday) return "everyday";
  if (id === MENU.developer) return "developer";
  if (id === MENU.mixed) return "mixed";
  return null;
}

const REVIEW_MENU: MenuEntry[] = [
  { id: 1, label: "Send review" },
  { id: 2, label: "Read on phone" },
  { id: 3, label: "Clear notes" },
  { id: 4, label: "Refresh" },
];

function inboxMenu(state: State): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const item = state.inbox[state.inboxFocus];
  if (item?.kind === "catch-up") {
    entries.push({ id: MENU.markSeen, label: "Mark seen" });
  } else if (item && item.attention !== "question") {
    // A question needs an answer, so "Agree & send" is only offered for the rest.
    entries.push({ id: MENU.agree, label: "Agree & send" });
  }
  entries.push({ id: MENU.newTask, label: "New task" });
  if (state.workspace === "sample") {
    // The sample story: everyday errands, coding agents, or both. Only here.
    for (const persona of SAMPLE_PERSONAS) {
      const mark = persona === state.persona ? " (now)" : "";
      entries.push({
        id: MENU[persona],
        label: `Sample: ${PERSONA_LABEL[persona]}${mark}`,
      });
    }
  }
  entries.push({ id: MENU.refresh, label: "Refresh" });
  if (state.workspace === "sample") entries.push({ id: MENU.reset, label: "Reset sample" });
  return entries;
}

function reviewMenu(state: State): MenuEntry[] {
  if (isCatchUp(state)) {
    const seen: MenuEntry[] = [
      { id: MENU.markSeen, label: "Mark seen" },
      { id: MENU.refresh, label: "Refresh" },
    ];
    return state.workspace === "sample" ? [...seen, { id: MENU.reset, label: "Reset sample" }] : seen;
  }
  // Ask is the first thing on a review: a question saves scrolling the list.
  const entries = state.screen === "review" && state.deck
    ? [{ id: MENU.ask, label: "Ask" }, ...REVIEW_MENU]
    : REVIEW_MENU;
  return state.workspace === "sample"
    ? [...entries, { id: 5, label: "Reset sample" }]
    : entries;
}

function routineRow(count: number, focused: boolean): string {
  return cursorRow(`+${count} routine${DOT}agreed`, focused);
}

/** The source app of the open thread; older saved states had no app field. */
export function reviewAppOf(state: State): AppId {
  if (state.reviewApp) return state.reviewApp;
  const item = state.inbox.find((entry) => entry.threadId === state.reviewThreadId);
  return item?.app ?? "t3";
}

/** Mail subject prefixes ("Re:", "Fwd:", "AW:" …) are never a person's name. */
const MAIL_PREFIX = /^(?:(?:re|fwd?|aw|wg|sv|vs|antw|tr)\s*:\s*)+/i;

/** "Draft reply to Priya: contract terms" -> "Priya"; "Priya: terms" -> "Priya"; "Re: lease renewal" -> null. */
export function recipientFor(title: string): string | null {
  const subject = title.replace(MAIL_PREFIX, "");
  const afterTo = /\bto\s+([^:,·]+)/i.exec(subject)?.[1]?.trim();
  const beforeColon = /^([A-Z][A-Za-z0-9'’-]*(?:\s+[A-Z][A-Za-z0-9'’-]*)?)\s*:/.exec(subject)?.[1]?.trim();
  const name = afterTo ?? beforeColon;
  if (!name || name.length > 20) return null;
  return name;
}

function changeWords(count: number): string {
  return `${count} change${count === 1 ? "" : "s"}`;
}

/**
 * The Send row names the real destination, so nobody wonders what "send"
 * means: a mail draft goes to a person, a Notion page gets comments, an agent
 * gets the review.
 */
function sendRowLabel(state: State): string {
  if (isCatchUp(state)) return "Mark seen";
  const total = state.deck?.points.length ?? 0;
  const changes = state.notes.length;
  const ok = Math.max(0, total - changes);
  const app = reviewAppOf(state);
  if (app === "gmail") {
    const name = recipientFor(state.reviewTitle || state.deck?.title || "");
    const base = name ? `Send to ${name}` : "Send";
    return changes > 0 ? `${base}${DOT}${changeWords(changes)}` : base;
  }
  if (app === "notion") {
    if (changes === 0) return "Approve";
    return `Post ${changes} comment${changes === 1 ? "" : "s"}`;
  }
  return changes > 0
    ? `Send${DOT}${changeWords(changes)}, ${ok} OK`
    : `Send${DOT}${ok} OK`;
}

/**
 * "2 need you · 3 working · 4 done today", longest form first. Shorter forms drop
 * the least urgent part so the header still fits next to the workspace name.
 */
export function statusVariants(status: AgentStatus): string[] {
  const need = status.needYou === 0
    ? "All clear"
    : `${status.needYou} ${status.needYou === 1 ? "needs" : "need"} you`;
  const working = `${status.working} working`;
  return [
    `${need}${DOT}${working}${DOT}${status.doneToday} done today`,
    `${need}${DOT}${working}${DOT}${status.doneToday} done`,
    `${need}${DOT}${working}`,
    need,
  ];
}

/** `Pinpoint · 2 need you · 3 working · 4 done today`, shortened by pixels to fit. */
export function inboxTitle(name: string, status: AgentStatus | null, count: number): string {
  if (!status) {
    return count === 0 ? name : `${name}${DOT}${count} ${count === 1 ? "needs" : "need"} you`;
  }
  for (const variant of statusVariants(status)) {
    const full = `${name}${DOT}${variant}`;
    if (textWidth(full) <= HEADER_MAX_PX && full.length <= ROW_WIDTH) return full;
  }
  const last = statusVariants(status).at(-1) ?? "";
  return fitTitle(name, `${DOT}${last}`);
}

/** Just put on: what happened "Since you looked", from the catch-up row, with no tap. */
export function welcomeLine(inbox: readonly InboxItem[]): string {
  const news = inbox.find((item) => item.kind === "catch-up");
  if (!news) return "Welcome back · nothing new";
  return asciiTruncate(`${news.title}${DOT}${news.summary}`, ROW_WIDTH, HEADER_MAX_PX);
}

/** The New task screens: say it, confirm it with one tap, then it is started. */
function taskPage(task: TaskNotice | null, state: State, now: number): PageModel {
  const title = "New task";
  const page = (pane: string, footer: string): PageModel => ({
    kind: "task", title, rows: [], pane, footer, menu: [],
  });
  switch (task?.phase) {
    case "recording": {
      const seconds = Math.max(0, Math.floor((now - (state.recordingStartedAt ?? now)) / 1000));
      return page(
        `What should I start?${DOT}${seconds}s\nTap to stop`,
        `Tap: stop${DOT}Double-tap: cancel`,
      );
    }
    case "transcribing":
      return page("Working...", "Double-tap: cancel");
    case "confirm":
      return page(
        wrapAscii(`Start: ${task.text}`, PANE_WIDTH, 3, PREVIEW_MAX_PX),
        `Tap: start${DOT}Double-tap: cancel`,
      );
    case "starting":
      return page("Starting...", "Starting...");
    case "started":
      return page(
        wrapParagraphs(`Started${DOT}${task.agent ?? "Agent"}.\nYou'll see it when it needs you.`, 3, PREVIEW_MAX_PX),
        "Tap: inbox",
      );
    case "error":
      return page(
        wrapAscii(task.error ?? "Couldn't start it.", PANE_WIDTH, 3, PREVIEW_MAX_PX),
        `Tap: try again${DOT}Double-tap: cancel`,
      );
    default:
      return page("Nothing to start.", "Double-tap: back");
  }
}

function previewLines(counts: { objections: number; answers: number; notes: number; agreed: number }): string {
  const changes = counts.objections + counts.answers + counts.notes;
  const summary = changes === 0
    ? `All ${counts.agreed} agreed`
    : `${changes} change${changes === 1 ? "" : "s"}, ${counts.agreed} agreed`;
  return `${fitLine(summary, PREVIEW_MAX_PX, LIST_WIDTH)}\nDouble-tap to send`;
}

export function pageFor(state: State, now: number): PageModel {
  if (state.screen === "inbox") {
    const sample = state.workspace === "sample";
    const name = sample
      ? "Sample"
      : state.workspace === "desk"
        ? asciiTruncate(state.desk?.name || "Desk", 24, HEADER_MAX_PX)
        : "Pinpoint";
    // Catch-up rows are news, not work: only real work counts as "needs you".
    const count = state.inbox.filter((item) => item.kind !== "catch-up").length;
    const title = state.loading || (count === 0 && !state.status)
      ? name
      : inboxTitle(name, state.status, count);
    const listed = state.inbox.length;
    const subtitle = state.offline
      ? "offline"
      : state.workspace === "desk" && state.desk && !state.desk.online
        ? "computer offline"
        : state.welcome && !state.loading
          ? welcomeLine(state.inbox)
          : state.demo
            ? "demo data"
            : undefined;
    const flash = state.flash && state.flash.until > now ? state.flash.text : null;
    const emptyFooter = sample ? "Hold: menu" : `Tap: retry${DOT}Hold: menu`;
    const base: PageModel = {
      kind: "inbox",
      title,
      subtitle,
      rows: [],
      footer: state.loading
        ? "Connecting..."
        : flash
          ? asciiTruncate(flash, ROW_WIDTH, HEADER_MAX_PX)
          : listed === 0 ? emptyFooter : `Tap: open${DOT}Hold: menu`,
      menu: inboxMenu(state),
    };
    if (state.offline) {
      return {
        ...base,
        message: state.offlineMessage ?? "Server unreachable · tap to retry",
        footer: "Tap: retry",
      };
    }
    if (state.loading) {
      return { ...base, message: "Checking your agents..." };
    }
    if (listed === 0) {
      return {
        ...base,
        message: sample
          ? "All clear. Hold for menu: Reset sample"
          : "All clear.\nYour agents are working.",
      };
    }
    const tagged = mixedApps(state.inbox);
    return {
      ...base,
      list: state.inbox.map((item) => inboxRow(item, tagged)),
      listFocus: state.inboxFocus,
    };
  }

  if (state.screen === "task") return taskPage(state.task, state, now);

  if (state.screen === "review") {
    const slots = reviewSlots(state);
    return {
      kind: "review",
      title: reviewHeader(state),
      rows: slots.map((slot) => {
        if (slot.kind === "send") {
          return {
            text: cursorRow(sendRowLabel(state), slot.focused),
            brightness: slot.focused ? 4 : BRIGHTNESS.send,
          };
        }
        if (slot.kind === "routine") {
          return {
            text: routineRow(slot.count, slot.focused),
            brightness: slot.focused ? BRIGHTNESS.routineFocused : BRIGHTNESS.routine,
          };
        }
        return {
          text: pointRow(slot.point, state, slot.focused),
          brightness: pointBrightness(slot.point, state, slot.focused),
        };
      }),
      pane: reviewPane(state, now),
      footer: reviewFooter(state),
      menu: reviewMenu(state),
    };
  }

  if (state.screen === "options") {
    const point = focusedPoint(state);
    const options = point?.options ?? [];
    const rows: PageRow[] = options.map((option, index) => ({
      text: cursorRow(`${index + 1} ${option}`, index === state.optionsFocus),
      brightness: index === state.optionsFocus ? 4 : 2,
    }));
    rows.push({
      text: cursorRow("Say something else", state.optionsFocus === options.length),
      brightness: state.optionsFocus === options.length ? 4 : 2,
    });
    return {
      kind: "options",
      title: fitTitle(state.deck?.title ?? "Question", `${DOT}choose`),
      rows,
      footer: `Tap: choose${DOT}Double-tap: list`,
      menu: reviewMenu(state),
    };
  }

  if (state.screen === "countdown") {
    const left = countdownLeft(state, now);
    const title = state.deck?.title ?? state.pendingSend?.title ?? "Send";
    return {
      kind: "countdown",
      title: fitTitle(title, `${DOT}sending`),
      rows: [],
      pane: state.sending ? "Sending..." : `Sending in ${left}${DOT}Tap to undo`,
      footer: state.sending ? "Sending..." : "Tap: undo",
      menu: [],
    };
  }

  if (state.screen === "receipt") {
    const lines = state.receiptLines
      .slice(0, 3)
      .map((line) => asciiTruncate(line, PANE_WIDTH, PANE_MAX_PX));
    return {
      kind: "receipt",
      title: "Sent",
      rows: [],
      pane: lines.join("\n") || "Sent to the agent.",
      footer: "Tap: inbox",
      menu: [],
    };
  }

  const preview = state.preview;
  const pane = state.sent
    ? state.workspace === "sample"
      ? "Sent. The sample agent will reply."
      : "Sent to the agent."
    : state.sending
      ? "Sending..."
      : state.flash && state.flash.until > now
        ? wrapAscii(state.flash.text, PANE_WIDTH, 3, PREVIEW_MAX_PX)
        : preview
          ? previewLines(preview.counts)
          : state.previewLoading
            ? "Building review..."
            : "No preview yet.";
  return {
    kind: "preview",
    title: "Send review",
    rows: [],
    pane,
    footer: state.sent
      ? "Returning to inbox..."
      : state.sending
        ? "Sending..."
        : state.previewLoading
          ? "Building preview..."
          : preview
            ? "Tap: back"
            : "Tap: retry",
    menu: reviewMenu(state),
  };
}
