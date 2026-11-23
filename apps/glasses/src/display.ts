import type { InboxItem, Point } from "../../../shared/contract";
import {
  countNotes, focusedPoint, noteFor, REVIEW_ROWS, type State,
} from "./model";

export const DOT = " | ";
export const ROW_WIDTH = 44;
export const LIST_WIDTH = 62;
export const PANE_WIDTH = 44;

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
  "—": "-", "–": "-", "·": "|", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'",
  "→": "->", "←": "<-", "✓": "+", "✗": "x", "●": "*", "○": "o", "▶": ">", "•": "-",
  "≥": ">=", "≤": "<=", "\u00a0": " ", "\u2028": " ", "\u2029": " ",
};

/** The glasses have one font; keep every string inside printable ASCII. */
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

/** Single-line ASCII label, hard-capped so one row never wraps. */
export function asciiTruncate(value: string, max = ROW_WIDTH): string {
  const ascii = toAscii(value).replace(/\s+/g, " ").trim();
  if (ascii.length <= max) return ascii;
  return `${ascii.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

/** Word-wrap into at most `lines` lines, ellipsis on the last if needed. */
export function wrapAscii(value: string, width = PANE_WIDTH, lines = 3): string {
  const text = toAscii(value);
  if (!text) return "";
  const words = text.split(" ").filter(Boolean);
  const out: string[] = [];
  let line = "";
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) {
      line = candidate;
      index++;
      continue;
    }
    if (line) {
      out.push(line);
      line = "";
      if (out.length === lines) break;
      continue;
    }
    out.push(word.slice(0, width));
    index++;
    if (out.length === lines) break;
  }
  if (line && out.length < lines) out.push(line);
  if (index < words.length) {
    const last = out[out.length - 1] ?? "";
    out[out.length - 1] = last.length + 3 <= width
      ? `${last}...`
      : `${last.slice(0, Math.max(0, width - 3))}...`;
  }
  return out.slice(0, lines).join("\n");
}

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

/** Prefix a row with the cursor, keeping the indent out of the ASCII trim. */
function cursorRow(text: string, focused: boolean, max = ROW_WIDTH): string {
  return `${focused ? "> " : "  "}${asciiTruncate(text, max - 2)}`;
}

/** A ">" cursor leads the focused row; every other row keeps the same two-character indent. */
export function pointRow(point: Point, state: State, focused = false): string {
  const risk = point.risk === "high" ? "!" : "";
  return cursorRow(`${risk}${markerFor(point, state)} ${point.index} ${point.glance}`, focused);
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

function inboxSymbol(item: InboxItem): string {
  switch (item.attention) {
    case "question": return "?";
    case "plan": return ">";
    case "failed": return "!";
    case "report": return "*";
  }
}

export function inboxRow(item: InboxItem): string {
  return asciiTruncate(`${inboxSymbol(item)} ${item.title}${DOT}${item.summary}`, LIST_WIDTH);
}

function noteParts(state: State): string[] {
  const counts = countNotes(state.notes);
  const parts: string[] = [];
  if (counts.objections > 0) {
    parts.push(`${counts.objections} objection${counts.objections === 1 ? "" : "s"}`);
  }
  if (counts.answers > 0) {
    parts.push(`${counts.answers} answer${counts.answers === 1 ? "" : "s"}`);
  }
  if (counts.notes > 0) {
    parts.push(`${counts.notes} note${counts.notes === 1 ? "" : "s"}`);
  }
  return parts;
}

/** Fit a title plus suffix into 44 characters, shortening the title first. */
export function fitTitle(title: string, suffix: string, max = ROW_WIDTH): string {
  const room = max - suffix.length;
  if (room >= 4) return `${asciiTruncate(title, room)}${suffix}`;
  return asciiTruncate(`${title}${suffix}`, max);
}

/** `auth-refresh-fix | 4/7 | 1 objection` — words, no cryptic counters. */
export function reviewHeader(state: State): string {
  const deck = state.deck;
  if (!deck) return asciiTruncate(state.reviewTitle || "Review", ROW_WIDTH);
  const position = Math.min(state.focus + 1, deck.points.length);
  const meta = `${position}/${deck.points.length}`;
  const parts = noteParts(state);
  // Keep the most important counts first; drop later ones only if the title cannot shrink enough.
  for (let count = parts.length; count > 0; count--) {
    const summary = parts.slice(0, count).join(", ");
    const full = fitTitle(deck.title, `${DOT}${meta}${DOT}${summary}`);
    if (full.endsWith(summary)) return full;
  }
  return fitTitle(deck.title, `${DOT}${meta}`);
}

function optionLines(point: Point): string {
  const options = point.options ?? [];
  if (options.length === 0) return wrapAscii(`"${point.quote}"`);
  return options.slice(0, 3).map((option, index) => `${index + 1} ${asciiTruncate(option, 40)}`).join("\n");
}

function reviewPane(state: State, now: number): string {
  if (state.recordingStartedAt !== null) {
    const seconds = Math.max(0, Math.floor((now - state.recordingStartedAt) / 1000));
    return `* REC ${seconds}s${DOT}tap to stop`;
  }
  if (state.flash && state.flash.until > now) return wrapAscii(state.flash.text);
  const deck = state.deck;
  if (!deck) {
    return state.deckError
      ? wrapAscii(`${state.deckError}\nTap to retry.`)
      : "Building points...";
  }
  const point = deck.points[state.focus];
  if (!point) return wrapAscii(`Send ${state.notes.length} note${state.notes.length === 1 ? "" : "s"} to ${deck.title}.`);
  if (point.kind === "question") return optionLines(point);
  return wrapAscii(`"${point.quote}"`);
}

function reviewFooter(state: State): string {
  if (state.recordingStartedAt !== null) return `tap: stop${DOT}2x: back`;
  if (!state.deck) return state.deckError ? `tap: retry${DOT}2x: back` : "2x: back";
  const point = state.deck.points[state.focus];
  if (!point) return `tap: preview${DOT}2x: back`;
  if (point.kind === "question") return `tap: options${DOT}2x: back`;
  return `tap: talk${DOT}2x: back`;
}

const REVIEW_MENU: MenuEntry[] = [
  { id: 1, label: "Send review" },
  { id: 2, label: "Read on phone" },
  { id: 3, label: "Clear notes" },
  { id: 4, label: "Refresh" },
];

const INBOX_MENU: MenuEntry[] = [{ id: 4, label: "Refresh" }];

export function pageFor(state: State, now: number): PageModel {
  if (state.screen === "inbox") {
    const title = state.loading
      ? "PINPOINT"
      : state.inbox.length === 0
        ? "PINPOINT"
        : `PINPOINT${DOT}${state.inbox.length} ${state.inbox.length === 1 ? "needs" : "need"} you`;
    const subtitle = state.demo ? "demo data" : state.offline ? "offline" : undefined;
    const base: PageModel = {
      kind: "inbox",
      title,
      subtitle,
      rows: [],
      footer: state.loading ? "Connecting..." : `swipe: move${DOT}tap: open${DOT}2x: exit`,
      menu: INBOX_MENU,
    };
    if (state.offline) {
      return { ...base, message: "Server unreachable | tap to retry", footer: `tap: retry${DOT}2x: exit` };
    }
    if (state.loading) {
      return { ...base, message: "Checking your agents..." };
    }
    if (state.inbox.length === 0) {
      return { ...base, message: "All clear.\nYour agents are working." };
    }
    return {
      ...base,
      list: state.inbox.map(inboxRow),
      listFocus: state.inboxFocus,
    };
  }

  if (state.screen === "review") {
    const slots = reviewSlots(state);
    return {
      kind: "review",
      title: reviewHeader(state),
      rows: slots.map((slot) => slot.kind === "send"
        ? {
          text: cursorRow(
            `Send review (${slot.count} note${slot.count === 1 ? "" : "s"})`,
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
      menu: REVIEW_MENU,
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
      title: fitTitle(state.deck?.title ?? "Question", `${DOT}answer`),
      rows,
      footer: `tap: choose${DOT}2x: back`,
      menu: REVIEW_MENU,
    };
  }

  const preview = state.preview;
  const pane = state.sent
    ? "Sent to agent"
    : state.sending
      ? "Sending..."
      : state.flash && state.flash.until > now
        ? wrapAscii(state.flash.text)
        : preview
          ? preview.preview.map((line) => asciiTruncate(line, PANE_WIDTH)).slice(0, 2).join("\n")
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
          : `tap: send${DOT}2x: back`,
    menu: REVIEW_MENU,
  };
}
