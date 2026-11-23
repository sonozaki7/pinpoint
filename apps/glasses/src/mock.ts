import type {
  Deck, InboxItem, Note, Point, PreviewResult, ReviewDraft, SendResult, ThreadAttention,
} from "../../../shared/contract";
import type { PinpointApi } from "./api";

const PROJECT = "pinpoint";

function point(
  id: string,
  index: number,
  kind: Point["kind"],
  glance: string,
  quote: string,
  extra: Partial<Point> = {},
): Point {
  return { id, index, kind, glance, quote, ...extra };
}

/** SPEC section 12 demo fixture 1: plan, seven steps, risky step 4, mutex step 6. */
export function createAuthDeck(): Deck {
  return {
    threadId: "auth-refresh-fix",
    sourceMessageId: "msg-auth-1",
    title: "auth-refresh-fix",
    attention: "plan",
    headline: "Fix auth refresh flow",
    points: [
      point("p1", 1, "step", "Add refresh_tokens migration", "Add a refresh_tokens table and migration."),
      point("p2", 2, "step", "Move signing into session.ts", "Move token signing into lib/auth/session.ts."),
      point("p3", 3, "step", "Rotate token on every refresh", "Rotate the refresh token on every refresh."),
      point("p4", 4, "step", "Force-logout all users", "Force-logout every user by truncating the sessions table.", {
        risk: "high",
      }),
      point("p5", 5, "step", "Backfill sessions before deploy", "Backfill all existing sessions before deploy."),
      point("p6", 6, "step", "Wrap refreshToken in a mutex", "Wrap refreshToken() in a mutex."),
      point("p7", 7, "step", "Add concurrent refresh tests", "Add integration tests for concurrent refresh."),
    ],
    createdAt: "2026-11-24T08:22:00.000Z",
    splitter: "fixture",
  };
}

/** SPEC section 12 demo fixture 2: one question with three options. */
export function createDepsDeck(): Deck {
  return {
    threadId: "deps-upgrade",
    sourceMessageId: "msg-deps-1",
    title: "deps-upgrade",
    attention: "question",
    headline: "Vite upgrade timing",
    points: [
      point("p1", 1, "question", "Vite 7 upgrade timing", "Upgrade to Vite 7 now or stay on 6?", {
        options: ["Stay on 6 for now", "Upgrade to 7", "Upgrade in a branch"],
        questionId: "q-vite",
      }),
    ],
    createdAt: "2026-11-24T08:25:00.000Z",
    splitter: "fixture",
  };
}

/** SPEC section 12 demo fixture 3: an inbox-triage report with four drafts. */
export function createInboxMorningDeck(): Deck {
  return {
    threadId: "inbox-morning",
    sourceMessageId: "msg-inbox-1",
    title: "inbox-morning",
    attention: "report",
    headline: "4 drafts ready",
    points: [
      point("p1", 1, "draft", "Reply to Sarah re budget", "Reply to Sarah about the Q1 budget numbers."),
      point("p2", 2, "draft", "Archive 12 newsletters", "Archive the 12 newsletters from overnight."),
      point("p3", 3, "draft", "Book dentist follow-up", "Schedule the dentist follow-up for Friday."),
      point("p4", 4, "draft", "Forward invoice to accounting", "Forward invoice #2041 to accounting."),
    ],
    createdAt: "2026-11-24T07:55:00.000Z",
    splitter: "fixture",
  };
}

/** SPEC section 12 demo fixture 4: a failed end-to-end run and its diagnosis. */
export function createFlakyDeck(): Deck {
  return {
    threadId: "flaky-e2e",
    sourceMessageId: "msg-flaky-1",
    title: "flaky-e2e",
    attention: "failed",
    headline: "Checkout e2e failed",
    points: [
      point("p1", 1, "claim", "Checkout e2e times out", "The checkout e2e test times out on the payment step."),
      point("p2", 2, "risk", "Retry mask hides failure", "The retry mask hides the real failure.", { risk: "high" }),
      point("p3", 3, "claim", "Wait for network idle", "Fix by waiting for the network idle event."),
    ],
    createdAt: "2026-11-24T07:40:00.000Z",
    splitter: "fixture",
  };
}

export function createDemoDecks(): Deck[] {
  return [createDepsDeck(), createAuthDeck(), createFlakyDeck(), createInboxMorningDeck()];
}

export function createDemoInbox(): InboxItem[] {
  return sortInbox([
    {
      threadId: "deps-upgrade", title: "deps-upgrade", project: PROJECT, attention: "question",
      summary: "question", updatedAt: "2026-11-24T08:25:00.000Z", deckReady: true, pointCount: 1, draftNotes: 0,
    },
    {
      threadId: "auth-refresh-fix", title: "auth-refresh-fix", project: PROJECT, attention: "plan",
      summary: "plan, 7 steps", updatedAt: "2026-11-24T08:22:00.000Z", deckReady: true, pointCount: 7, draftNotes: 0,
    },
    {
      threadId: "flaky-e2e", title: "flaky-e2e", project: PROJECT, attention: "failed",
      summary: "run failed", updatedAt: "2026-11-24T07:40:00.000Z", deckReady: true, pointCount: 3, draftNotes: 0,
    },
    {
      threadId: "inbox-morning", title: "inbox-morning", project: PROJECT, attention: "report",
      summary: "4 drafts", updatedAt: "2026-11-24T07:55:00.000Z", deckReady: true, pointCount: 4, draftNotes: 0,
    },
  ]);
}

const ATTENTION_ORDER: Record<ThreadAttention, number> = { question: 0, plan: 1, failed: 2, report: 3 };

export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const kind = ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention];
    return kind !== 0 ? kind : b.updatedAt.localeCompare(a.updatedAt);
  });
}

export const MOCK_TRANSCRIPT = "No, keep the existing sessions and migrate them instead.";

function cutQuote(quote: string): string {
  return quote.length > 140 ? `${quote.slice(0, 140)}…` : quote;
}

export function composeReview(deck: Deck, notes: readonly Note[]): PreviewResult {
  const noted = new Set(notes.map((note) => note.pointId));
  const objections = notes.filter((note) => note.verdict === "object");
  const answers = notes.filter((note) => note.verdict === "answer");
  const plain = notes.filter((note) => note.verdict === "note");
  const agreed = deck.points.filter((point) => !noted.has(point.id));
  const byId = new Map(deck.points.map((point) => [point.id, point]));
  const line = (mark: string, note: Note, value: string) => {
    const point = byId.get(note.pointId);
    if (!point) return "";
    return `${mark} ${point.index}. "${cutQuote(point.quote)}" → ${value}`;
  };
  const lines = [`Review from G2 (Pinpoint) — ${deck.points.length} points`];
  for (const note of objections) lines.push(line("✗", note, note.text ?? "Objection."));
  for (const note of answers) lines.push(line("?", note, note.option ?? note.text ?? "Answered."));
  for (const note of plain) lines.push(line("●", note, note.text ?? "Noted."));
  if (notes.length === 0) {
    lines.push(`✓ Reviewed on G2: all ${deck.points.length} points agreed. Continue.`);
  } else if (agreed.length > 0) {
    const numbers = agreed.map((point) => point.index).join(", ");
    const close = deck.attention === "plan" ? "Go ahead with the rest of the plan." : "Continue.";
    lines.push(`✓ Agreed: ${numbers}. ${close}`);
  }
  const parts = [
    `${objections.length} objection${objections.length === 1 ? "" : "s"}`,
    `${answers.length} answer${answers.length === 1 ? "" : "s"}`,
    `${plain.length} note${plain.length === 1 ? "" : "s"}`,
  ].filter((part) => !part.startsWith("0 "));
  const summary = notes.length === 0
    ? `All ${deck.points.length} points agreed`
    : `${parts.join(", ")}, ${agreed.length} agreed`;
  return {
    message: lines.join("\n"),
    preview: [summary, `Tap to send to ${deck.title}`],
    counts: {
      objections: objections.length,
      answers: answers.length,
      notes: plain.length,
      agreed: agreed.length,
    },
  };
}

/** In-memory implementation of the SPEC section 5 API, used for the standalone demo. */
export class MockPinpointApi implements PinpointApi {
  readonly mode = "demo" as const;
  private inboxItems: InboxItem[];
  private decks: Map<string, Deck>;
  private drafts = new Map<string, ReviewDraft>();
  private resolved = new Set<string>();

  constructor() {
    this.inboxItems = createDemoInbox();
    this.decks = new Map(createDemoDecks().map((deck) => [deck.threadId, deck]));
  }

  inbox(): Promise<{ items: InboxItem[]; updatedAt: string }> {
    const items = sortInbox(this.inboxItems
      .filter((item) => !this.resolved.has(item.threadId))
      .map((item) => ({ ...item, draftNotes: this.drafts.get(item.threadId)?.notes.length ?? 0 })));
    return Promise.resolve({ items, updatedAt: new Date().toISOString() });
  }

  deck(threadId: string): Promise<Deck> {
    const deck = this.decks.get(threadId);
    return deck ? Promise.resolve(structuredClone(deck)) : Promise.reject(new Error(`Unknown deck: ${threadId}`));
  }

  putReview(draft: ReviewDraft): Promise<ReviewDraft> {
    this.drafts.set(draft.threadId, structuredClone(draft));
    return Promise.resolve(draft);
  }

  preview(threadId: string, draft?: ReviewDraft): Promise<PreviewResult> {
    const deck = this.decks.get(threadId);
    if (!deck) return Promise.reject(new Error(`Unknown deck: ${threadId}`));
    const notes = draft?.notes ?? this.drafts.get(threadId)?.notes ?? [];
    return Promise.resolve(composeReview(deck, notes));
  }

  send(threadId: string): Promise<SendResult> {
    const deck = this.decks.get(threadId);
    if (!deck) return Promise.resolve({ ok: false, delivered: "demo-log", error: "Unknown thread" });
    this.resolved.add(threadId);
    this.drafts.delete(threadId);
    return Promise.resolve({ ok: true, delivered: "demo-log" });
  }

  voice(_pcm?: Uint8Array): Promise<{ text: string; verdict: "object" | "note" }> {
    return Promise.resolve({ text: MOCK_TRANSCRIPT, verdict: "object" });
  }
  phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }> {
    return Promise.resolve({ ok: true, link: `https://t.me/c/1234567890/42?thread=${threadId}-${pointId}` });
  }
}
