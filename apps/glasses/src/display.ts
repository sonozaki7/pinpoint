import type { InboxItem, Point } from "../../../shared/contract";
import {
  countNotes, focusedPoint, noteFor, REVIEW_ROWS, type State,
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
  const note = noteFor(state, point.id);
  if (note) {
    if (note.verdict === "object") return "CHANGE";
    if (note.verdict === "note") return "NOTE";
    return note.option ?? "ANSWER";
  }
  if (point.risk === "high" || point.flag) return "CHECK";
  return "";
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

export type Slot = RowSlot | SendSlot;

export function reviewSlots(state: State): Slot[] {
  const deck = state.deck;
  if (!deck) return [];
  const items: Slot[] = deck.points.map((point, index) => ({
    kind: "point",
    point,
    focused: index === state.focus,
  }));
  items.push({ kind: "send", count: state.notes.length, focused: state.focus === deck.points.length });
  const rows = Math.min(REVIEW_ROWS, items.length);
  const start = Math.min(
    Math.max(0, state.focus - (rows - 1)),
    Math.max(0, items.length - rows),
  );
  return items.slice(start, start + rows);
}

/** `<title>  <summary>` — no leading symbol; the summary already says what it is. */
export function inboxRow(item: InboxItem): string {
  const title = toAscii(item.title);
  const summary = toAscii(item.summary);
  return fitLine(`${title}  ${summary}`, LIST_ITEM_MAX_PX, LIST_WIDTH);
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
  const position = Math.min(state.focus + 1, deck.points.length);
  const counts = countNotes(state.notes);
  const changes = counts.objections + counts.answers;
  const parts = [`${position} of ${deck.points.length}`];
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

function reviewPane(state: State, now: number): string {
  if (state.recordingStartedAt !== null) {
    const seconds = Math.max(0, Math.floor((now - state.recordingStartedAt) / 1000));
    return `Recording ${seconds}s${DOT}tap to stop`;
  }
  if (state.flash && state.flash.until > now) return wrapAscii(state.flash.text);
  const deck = state.deck;
  if (!deck) {
    return state.deckError
      ? wrapAscii(`${state.deckError}\nTap to retry.`)
      : "Building points...";
  }
  const point = deck.points[state.focus];
  if (!point) return wrapAscii(`Send your review to ${deck.title}.`);
  const note = noteFor(state, point.id);
  if (note) {
    if (note.option) return wrapAscii(`You chose: ${note.option}`);
    if (note.text) return wrapAscii(`You said: ${note.text}`);
  }
  if (point.kind === "question") return optionLines(point);
  return wrapAscii(`"${point.quote}"`);
}

function reviewFooter(state: State): string {
  if (state.recordingStartedAt !== null) return `Tap: stop${DOT}Double-tap: back`;
  if (!state.deck) return state.deckError ? `Tap: retry${DOT}Double-tap: back` : "Double-tap: back";
  const point = state.deck.points[state.focus];
  if (!point) return `Tap: preview${DOT}Double-tap: back`;
  if (point.kind === "question") return `Tap: answer${DOT}Double-tap: back`;
  return `Tap: talk${DOT}Double-tap: back`;
}

const REVIEW_MENU: MenuEntry[] = [
  { id: 1, label: "Send review" },
  { id: 2, label: "Read on phone" },
  { id: 3, label: "Clear notes" },
  { id: 4, label: "Refresh" },
];

function inboxMenu(state: State): MenuEntry[] {
  return state.workspace === "sample"
    ? [{ id: 4, label: "Refresh" }, { id: 5, label: "Reset sample" }]
    : [{ id: 4, label: "Refresh" }];
}

function reviewMenu(state: State): MenuEntry[] {
  return state.workspace === "sample"
    ? [...REVIEW_MENU, { id: 5, label: "Reset sample" }]
    : REVIEW_MENU;
}

function sendLabel(count: number, total: number): string {
  const changed = Math.max(0, Math.min(count, total));
  const ok = Math.max(0, total - changed);
  const parts: string[] = [];
  if (changed > 0) parts.push(`${changed} change${changed === 1 ? "" : "s"}`);
  if (ok > 0) parts.push(`${ok} OK`);
  if (parts.length === 0) parts.push("0 OK");
  return `Send review${DOT}${parts.join(", ")}`;
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
    const name = sample ? "Sample" : "Pinpoint";
    const count = state.inbox.length;
    const title = state.loading || count === 0
      ? name
      : `${name}${DOT}${count} ${count === 1 ? "needs" : "need"} you`;
    const subtitle = state.demo ? "demo data" : state.offline ? "offline" : undefined;
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
          : count === 0 ? emptyFooter : `Tap: open${DOT}Hold: menu`,
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
    if (count === 0) {
      return {
        ...base,
        message: sample
          ? "All clear. Hold for menu: Reset sample"
          : "All clear.\nYour agents are working.",
      };
    }
    return {
      ...base,
      list: state.inbox.map(inboxRow),
      listFocus: state.inboxFocus,
    };
  }

  if (state.screen === "review") {
    const deck = state.deck;
    const slots = reviewSlots(state);
    return {
      kind: "review",
      title: reviewHeader(state),
      rows: slots.map((slot) => slot.kind === "send"
        ? {
          text: cursorRow(
            sendLabel(slot.count, deck?.points.length ?? slot.count),
            slot.focused,
          ),
          brightness: slot.focused ? 4 : 2,
        }
        : {
          text: pointRow(slot.point, state, slot.focused),
          brightness: slot.focused ? 4 : 2,
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
      footer: `Tap: choose${DOT}Double-tap: back`,
      menu: reviewMenu(state),
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
