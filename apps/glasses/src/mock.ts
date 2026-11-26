import type {
  Deck, Health, InboxItem, Note, PreviewResult, ReviewDraft, SendResult, ThreadAttention,
} from "../../../shared/contract";
import type { PinpointApi } from "./api";
import loginFixJson from "../../../demo/fixtures/login-fix.json";
import paymentUpgradeJson from "../../../demo/fixtures/payment-upgrade.json";
import inboxMorningJson from "../../../demo/fixtures/inbox-morning.json";

interface Fixture {
  thread: {
    threadId: string;
    title: string;
    project: string;
    attention: ThreadAttention;
    updatedAt: string;
  };
  deck: Deck;
}

const FIXTURES: Fixture[] = [
  loginFixJson as unknown as Fixture,
  paymentUpgradeJson as unknown as Fixture,
  inboxMorningJson as unknown as Fixture,
];

export function createLoginDeck(): Deck {
  return structuredClone((loginFixJson as unknown as Fixture).deck);
}

export function createPaymentDeck(): Deck {
  return structuredClone((paymentUpgradeJson as unknown as Fixture).deck);
}

export function createInboxMorningDeck(): Deck {
  return structuredClone((inboxMorningJson as unknown as Fixture).deck);
}

export function createDemoDecks(): Deck[] {
  return [createPaymentDeck(), createLoginDeck(), createInboxMorningDeck()];
}

function summaryFor(deck: Deck): string {
  const drafts = deck.points.filter((point) => point.kind === "draft").length;
  switch (deck.attention) {
    case "plan":
      return `plan, ${deck.points.length} steps`;
    case "question":
      return "question";
    case "report":
      return drafts > 0 ? `${drafts} drafts` : `${deck.points.length} points`;
    case "failed":
      return "run failed";
  }
}

export function createDemoInbox(): InboxItem[] {
  return sortInbox(FIXTURES.map(({ thread, deck }) => ({
    threadId: thread.threadId,
    title: thread.title,
    project: thread.project,
    attention: thread.attention,
    summary: summaryFor(deck),
    updatedAt: thread.updatedAt,
    deckReady: true,
    pointCount: deck.points.length,
    draftNotes: 0,
  })));
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

  health(): Promise<Health> {
    return Promise.resolve({
      ok: true,
      mode: "demo",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
    });
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

  resetSample(): Promise<void> {
    this.inboxItems = createDemoInbox();
    this.decks = new Map(createDemoDecks().map((deck) => [deck.threadId, deck]));
    this.drafts.clear();
    this.resolved.clear();
    return Promise.resolve();
  }
}
