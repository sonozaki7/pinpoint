import type {
  AppId, Deck, EditResult, Health, InboxItem, Note, PreviewResult, Receipt, ReviewDraft,
  SendResult, ThreadAttention,
} from "../../../shared/contract";
import { applyEdit, EDIT_FAILED } from "../../../shared/edit";
import type { PinpointApi } from "./api";
import loginFixJson from "../../../demo/fixtures/login-fix.json";
import paymentUpgradeJson from "../../../demo/fixtures/payment-upgrade.json";
import inboxMorningJson from "../../../demo/fixtures/inbox-morning.json";
import launchPostJson from "../../../demo/fixtures/launch-post.json";
import draftPriyaJson from "../../../demo/fixtures/draft-priya.json";
import transcriptsJson from "../../../demo/fixtures/transcripts.json";

interface Fixture {
  thread: {
    threadId: string;
    title: string;
    project: string;
    attention: ThreadAttention;
    updatedAt: string;
    app?: AppId;
  };
  deck: Deck;
}

const FIXTURES: Fixture[] = [
  loginFixJson as unknown as Fixture,
  paymentUpgradeJson as unknown as Fixture,
  inboxMorningJson as unknown as Fixture,
];

/** The budget-demo threads: a Notion page and a Gmail draft next to the agent. */
const BUDGET_FIXTURES: Fixture[] = [
  launchPostJson as unknown as Fixture,
  draftPriyaJson as unknown as Fixture,
];

interface Transcript { threadId: string; pointId: string; text: string }
const TRANSCRIPTS = (transcriptsJson as unknown as { notes: Transcript[] }).notes;

export function createLoginDeck(): Deck {
  return structuredClone((loginFixJson as unknown as Fixture).deck);
}

export function createPaymentDeck(): Deck {
  return structuredClone((paymentUpgradeJson as unknown as Fixture).deck);
}

export function createInboxMorningDeck(): Deck {
  return structuredClone((inboxMorningJson as unknown as Fixture).deck);
}

export function createLaunchPostDeck(): Deck {
  return structuredClone((launchPostJson as unknown as Fixture).deck);
}

export function createDraftPriyaDeck(): Deck {
  return structuredClone((draftPriyaJson as unknown as Fixture).deck);
}

export function createDemoDecks(): Deck[] {
  return [createPaymentDeck(), createLoginDeck(), createInboxMorningDeck()];
}

export function createBudgetDecks(): Deck[] {
  return [...createDemoDecks(), createLaunchPostDeck(), createDraftPriyaDeck()];
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

function inboxFor(fixtures: readonly Fixture[]): InboxItem[] {
  return sortInbox(fixtures.map(({ thread, deck }) => ({
    threadId: thread.threadId,
    title: thread.title,
    project: thread.project,
    attention: thread.attention,
    summary: summaryFor(deck),
    updatedAt: thread.updatedAt,
    deckReady: true,
    pointCount: deck.points.length,
    draftNotes: 0,
    ...(thread.app ? { app: thread.app } : {}),
  })));
}

export function createDemoInbox(): InboxItem[] {
  return inboxFor(FIXTURES);
}

/** The mixed inbox (?mock=1): agent work next to a Notion page and a mail draft. */
export function createBudgetInbox(): InboxItem[] {
  return inboxFor([...FIXTURES, ...BUDGET_FIXTURES]);
}

const ATTENTION_ORDER: Record<ThreadAttention, number> = { question: 0, plan: 1, failed: 2, report: 3 };

export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const kind = ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention];
    return kind !== 0 ? kind : b.updatedAt.localeCompare(a.updatedAt);
  });
}

export const MOCK_TRANSCRIPT = "No, keep the existing sessions and migrate them instead.";

/**
 * The same deterministic grammar as apps/server/src/core/edit.ts, from the
 * shared module. The demo has no LLM, so an unrecognised note fails with the
 * short glasses message instead.
 */
export function editDraftSentence(
  quote: string,
  note: string,
): { ok: boolean; after?: string; method?: EditResult["method"]; error?: string } {
  return applyEdit(quote, note);
}

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
  private readonly extended: boolean;

  constructor(options: { extended?: boolean } = {}) {
    this.extended = options.extended ?? false;
    this.inboxItems = this.extended ? createBudgetInbox() : createDemoInbox();
    this.decks = new Map(
      (this.extended ? createBudgetDecks() : createDemoDecks()).map((deck) => [deck.threadId, deck]),
    );
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

  edit(threadId: string, pointId: string, text: string): Promise<EditResult> {
    const deck = this.decks.get(threadId);
    const point = deck?.points.find((entry) => entry.id === pointId);
    if (!point || point.kind !== "draft") {
      return Promise.resolve({ ok: false, pointId, before: "", error: EDIT_FAILED });
    }
    const result = editDraftSentence(point.quote, text);
    return Promise.resolve({
      ok: result.ok,
      pointId,
      before: point.quote,
      ...(result.after !== undefined ? { after: result.after } : {}),
      ...(result.method ? { method: result.method } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  send(threadId: string): Promise<SendResult> {
    const deck = this.decks.get(threadId);
    if (!deck) return Promise.resolve({ ok: false, delivered: "demo-log", error: "Unknown thread" });
    const item = this.inboxItems.find((entry) => entry.threadId === threadId);
    const notes = this.drafts.get(threadId)?.notes.length ?? 0;
    const app = item?.app ?? "t3";
    this.resolved.add(threadId);
    this.drafts.delete(threadId);
    return Promise.resolve({
      ok: true,
      delivered: app === "gmail" ? "gmail" : app === "notion" ? "notion" : "demo-log",
      receipt: { lines: [receiptLine(app, deck, notes, item)] },
    });
  }

  voice(
    _pcm?: Uint8Array,
    context?: { threadId: string; pointId: string },
  ): Promise<{ text: string; verdict?: "object" | "note" }> {
    if (context) {
      const known = TRANSCRIPTS.find((entry) =>
        entry.threadId === context.threadId && entry.pointId === context.pointId);
      if (known) return Promise.resolve({ text: known.text });
    }
    return Promise.resolve({ text: MOCK_TRANSCRIPT, verdict: "object" });
  }

  phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }> {
    return Promise.resolve({ ok: true, link: `https://t.me/c/1234567890/42?thread=${threadId}-${pointId}` });
  }

  resetSample(): Promise<void> {
    this.inboxItems = this.extended ? createBudgetInbox() : createDemoInbox();
    this.decks = new Map(
      (this.extended ? createBudgetDecks() : createDemoDecks()).map((deck) => [deck.threadId, deck]),
    );
    this.drafts.clear();
    this.resolved.clear();
    return Promise.resolve();
  }
}

function receiptLine(app: AppId, deck: Deck, notes: number, item: InboxItem | undefined): Receipt["lines"][number] {
  const title = item?.title ?? deck.title;
  if (app === "gmail") {
    const match = /\bto\s+([^:,·]+)/i.exec(title);
    const name = match?.[1]?.trim() ?? "the draft";
    return { app, text: `Draft to ${name} updated`.slice(0, 44), ok: true };
  }
  if (app === "notion") {
    return {
      app,
      text: (notes === 0
        ? `Approved ${title}`
        : `${notes === 1 ? "1 comment" : `${notes} comments`} on ${title}`).slice(0, 44),
      ok: true,
    };
  }
  return { app, text: `Review delivered to ${title}`.slice(0, 44), ok: true };
}
