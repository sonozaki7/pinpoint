import type {
  AgentStatus, AppId, AskResult, Deck, EditResult, Health, InboxItem, Note, PreviewResult, Receipt,
  ReviewDraft, SendResult, TaskResult,
} from "../../../shared/contract";
import { askText, splitSentences, type AskSentence } from "../../../shared/ask";
import { applyEdit, EDIT_FAILED } from "../../../shared/edit";
import { sortInbox } from "../../../shared/inbox-order";
import { formatNeedsSummary, inboxSummary, needsYouCount } from "../../../shared/summary";
import { DEFAULT_PERSONA, type SamplePersona } from "./model";
import {
  catchUpFixture, CATCH_UP_THREAD_ID, EVERYDAY_FIXTURES, MOCK_NOTES, MOCK_QUESTIONS, MOCK_TASK_REQUEST,
  PERSONA_STATUS, PERSONA_THREADS, SAMPLE_FIXTURES,
  type MockFixture,
} from "./mock-fixtures";
import type { PinpointApi } from "./api";
import loginFixJson from "../../../demo/fixtures/login-fix.json";
import paymentUpgradeJson from "../../../demo/fixtures/payment-upgrade.json";
import inboxMorningJson from "../../../demo/fixtures/inbox-morning.json";
import launchPostJson from "../../../demo/fixtures/launch-post.json";
import draftPriyaJson from "../../../demo/fixtures/draft-priya.json";

type Fixture = MockFixture;

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

/** The spoken notes, straight from demo/fixtures/transcripts.json. */
const TRANSCRIPTS = MOCK_NOTES;

/**
 * Evidence lines for the demo fixtures. The fixture files may already carry a
 * `why`; this only fills the gaps so the glasses always have something to say
 * under a flagged line.
 */
const MOCK_WHY: Record<string, Record<string, string>> = {
  "login-fix": { p4: "Signs out every customer, not only broken ones" },
  "launch-post": { p4: "Launch week starts Monday with partners" },
  "draft-priya": { p2: "Your notes say net-45 (Acme, Nov 12)" },
  "payment-upgrade": {},
};

function withEvidence(deck: Deck): Deck {
  const why = MOCK_WHY[deck.threadId] ?? {};
  return {
    ...deck,
    points: deck.points.map((point) => {
      const reason = point.why ?? why[point.id];
      return reason && !point.why ? { ...point, why: reason } : point;
    }),
  };
}

export function createLoginDeck(): Deck {
  return withEvidence(structuredClone((loginFixJson as unknown as Fixture).deck));
}

export function createPaymentDeck(): Deck {
  return withEvidence(structuredClone((paymentUpgradeJson as unknown as Fixture).deck));
}

export function createInboxMorningDeck(): Deck {
  return withEvidence(structuredClone((inboxMorningJson as unknown as Fixture).deck));
}

export function createLaunchPostDeck(): Deck {
  return withEvidence(structuredClone((launchPostJson as unknown as Fixture).deck));
}

export function createDraftPriyaDeck(): Deck {
  return withEvidence(structuredClone((draftPriyaJson as unknown as Fixture).deck));
}

export function createSaturdayPlanDeck(): Deck {
  return withEvidence(structuredClone(EVERYDAY_FIXTURES[0]!.deck));
}

export function createLandlordReplyDeck(): Deck {
  return withEvidence(structuredClone(EVERYDAY_FIXTURES[1]!.deck));
}

export function createSchoolNewsletterDeck(): Deck {
  return withEvidence(structuredClone(EVERYDAY_FIXTURES[2]!.deck));
}

/** "Since you looked": one line per agent update, with a thread to open where there is one. */
export function createCatchUpDeck(persona: SamplePersona = DEFAULT_PERSONA): Deck {
  return structuredClone(catchUpFixture(persona).deck);
}

export function createDemoDecks(): Deck[] {
  return [createPaymentDeck(), createLoginDeck(), createInboxMorningDeck()];
}

export function createBudgetDecks(): Deck[] {
  return [...createDemoDecks(), createLaunchPostDeck(), createDraftPriyaDeck()];
}

function countChanged(deck: Deck): number {
  return deck.points.filter((point) => point.changed === true).length;
}

function inboxFor(fixtures: readonly Fixture[]): InboxItem[] {
  return sortInbox(fixtures.map(({ thread, deck: raw }) => {
    const deck = withEvidence(structuredClone(raw));
    if (thread.kind === "catch-up") {
      const count = deck.points.length;
      const needs = needsYouCount(deck.points);
      return {
        threadId: thread.threadId,
        title: thread.title,
        project: thread.project,
        attention: thread.attention,
        summary: formatNeedsSummary(`${count} update${count === 1 ? "" : "s"}`, needs),
        updatedAt: thread.updatedAt,
        deckReady: true,
        pointCount: count,
        draftNotes: 0,
        kind: "catch-up" as const,
        ...(needs > 0 ? { needsYou: needs } : {}),
      };
    }
    const changed = countChanged(deck);
    return {
      threadId: thread.threadId,
      title: thread.title,
      project: thread.project,
      attention: thread.attention,
      summary: inboxSummary(thread, deck.points),
      updatedAt: thread.updatedAt,
      deckReady: true,
      pointCount: deck.points.length,
      draftNotes: 0,
      ...(needsYouCount(deck.points) > 0 ? { needsYou: needsYouCount(deck.points) } : {}),
      ...(changed > 0 ? { changed } : {}),
      ...(thread.app ? { app: thread.app } : {}),
    };
  }));
}

export function createDemoInbox(): InboxItem[] {
  return inboxFor(FIXTURES);
}

/** The mixed inbox (?mock=1): agent work next to a Notion page and a mail draft. */
export function createBudgetInbox(): InboxItem[] {
  return inboxFor([...FIXTURES, ...BUDGET_FIXTURES]);
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

/** Source sentences, each tied to the deck point whose quote holds it. */
function sentencesFor(fixture: Fixture): AskSentence[] {
  return splitSentences(fixture.source.text).map((text) => {
    const point = fixture.deck.points.find((entry) =>
      entry.quote.includes(text) || text.includes(entry.quote));
    return { text, ...(point ? { pointId: point.id } : {}) };
  });
}

const ALL_FIXTURES: Fixture[] = [...FIXTURES, ...BUDGET_FIXTURES, ...EVERYDAY_FIXTURES, ...SAMPLE_FIXTURES];

/** The threads each sample story lists, in demo/sample/workspace.json order (sortInbox orders them), then the catch-up. */
function fixturesForPersona(persona: SamplePersona): Fixture[] {
  const listed = (PERSONA_THREADS[persona] ?? PERSONA_THREADS.mixed).flatMap((id) => {
    const found = ALL_FIXTURES.find((entry) => entry.thread.threadId === id);
    return found ? [found] : [];
  });
  return [...listed, catchUpFixture(persona)];
}

/** The inbox the offline demo shows for a story: work that needs you, then "Since you looked". */
export function createPersonaInbox(persona: SamplePersona = DEFAULT_PERSONA): InboxItem[] {
  return inboxFor(fixturesForPersona(persona));
}

/** Every deck the offline demo can open, for any story: a catch-up line may point at a thread the inbox does not list. */
export function createPersonaDecks(persona: SamplePersona = DEFAULT_PERSONA): Deck[] {
  return [...ALL_FIXTURES.map((entry) => withEvidence(structuredClone(entry.deck))), createCatchUpDeck(persona)];
}

function fixtureFor(threadId: string, persona: SamplePersona = DEFAULT_PERSONA): Fixture | undefined {
  if (threadId === CATCH_UP_THREAD_ID) return catchUpFixture(persona);
  return ALL_FIXTURES.find((entry) => entry.thread.threadId === threadId);
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
  private readonly sample: boolean;
  private persona: SamplePersona;
  private doneToday: number;
  private tasks = 0;

  /**
   * `extended` is the ?mock=1 showcase: the mixed story with a status line and "Since you looked".
   * `sample` also reports the cloud sample workspace, so the sample-only menu entries show.
   */
  constructor(options: { extended?: boolean; persona?: SamplePersona; sample?: boolean } = {}) {
    this.extended = options.extended ?? false;
    this.sample = options.sample ?? false;
    this.persona = options.persona ?? DEFAULT_PERSONA;
    this.doneToday = PERSONA_STATUS[this.persona].doneToday;
    this.inboxItems = this.freshInbox();
    this.decks = this.freshDecks();
  }

  private freshInbox(): InboxItem[] {
    return this.extended ? createPersonaInbox(this.persona) : createDemoInbox();
  }

  private freshDecks(): Map<string, Deck> {
    return new Map(
      (this.extended ? createPersonaDecks(this.persona) : createDemoDecks()).map((deck) => [deck.threadId, deck]),
    );
  }

  /** The glance line: what needs you now, what is running, what finished today. */
  private status(items: readonly InboxItem[]): AgentStatus {
    return {
      needYou: items.filter((item) => item.kind !== "catch-up").length,
      working: PERSONA_STATUS[this.persona].working,
      doneToday: this.doneToday,
    };
  }

  inbox(): Promise<{ items: InboxItem[]; updatedAt: string; status?: AgentStatus }> {
    const items = sortInbox(this.inboxItems
      .filter((item) => !this.resolved.has(item.threadId))
      .map((item) => ({ ...item, draftNotes: this.drafts.get(item.threadId)?.notes.length ?? 0 })));
    return Promise.resolve({
      items,
      updatedAt: new Date().toISOString(),
      ...(this.extended ? { status: this.status(items) } : {}),
    });
  }

  health(): Promise<Health> {
    return Promise.resolve({
      ok: true,
      mode: "demo",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
      ...(this.sample ? { workspace: "sample" as const } : {}),
    });
  }

  /** Switch the sample story (Everyday / Developer / Mixed), as the cloud does with its header. */
  setSample(persona: SamplePersona): void {
    this.persona = persona;
    this.inboxItems = this.freshInbox();
    this.decks = this.freshDecks();
    this.drafts.clear();
    this.resolved.clear();
    this.doneToday = PERSONA_STATUS[this.persona].doneToday;
  }

  /**
   * Stand-in for the wear sensor. Updates arrive while the glasses are off, so putting them on again
   * brings "Since you looked" back if it was already marked seen.
   */
  simulateWear(on: boolean): void {
    if (!on || !this.extended) return;
    for (const item of this.inboxItems) {
      if (item.kind === "catch-up") this.resolved.delete(item.threadId);
    }
  }

  /** Hand a job to an agent; the demo picks Codex for code-sounding work, Claude otherwise. */
  task(text: string): Promise<TaskResult> {
    const clean = text.trim();
    if (!clean) return Promise.resolve({ ok: false, error: "Say what to start." });
    this.tasks += 1;
    const agent = /\b(fix|bug|test|repo|deploy|build|code|merge|ci)\b/i.test(clean) ? "Codex" : "Claude";
    const title = clean.replace(/[^\x20-\x7e]/g, "").slice(0, 30).trim() || "New task";
    return Promise.resolve({ ok: true, threadId: `task-${this.tasks}`, title, agent });
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

  /** Deterministic retrieval over the fixture source, exactly as shared/ask.ts runs it. */
  ask(threadId: string, question: string): Promise<AskResult> {
    const fixture = fixtureFor(threadId, this.persona);
    if (!fixture) return Promise.resolve({ ok: false, answer: "Not in this output." });
    const match = askText(question, sentencesFor(fixture));
    return Promise.resolve({
      ok: match.ok,
      answer: match.answer,
      ...(match.quote ? { quote: match.quote } : {}),
      ...(match.pointId ? { pointId: match.pointId } : {}),
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
    if (item?.kind === "catch-up") {
      return Promise.resolve({
        ok: true,
        delivered: "demo-log",
        receipt: { lines: [{ app, text: "Marked seen", ok: true }] },
      });
    }
    this.doneToday += 1;
    return Promise.resolve({
      ok: true,
      delivered: app === "gmail" ? "gmail" : app === "notion" ? "notion" : "demo-log",
      receipt: { lines: [receiptLine(app, deck, notes, item)] },
    });
  }

  voice(
    _pcm?: Uint8Array,
    context?: { threadId: string; pointId?: string },
    purpose: "note" | "ask" | "task" = "note",
  ): Promise<{ text: string; verdict?: "object" | "note" }> {
    // The demo has no microphone, so each purpose has one believable thing to say.
    if (purpose === "task") return Promise.resolve({ text: MOCK_TASK_REQUEST });
    if (purpose === "ask") {
      return Promise.resolve({
        text: (context ? MOCK_QUESTIONS[context.threadId] : undefined) ?? "What is this about?",
      });
    }
    if (context?.pointId) {
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
    this.inboxItems = this.freshInbox();
    this.decks = this.freshDecks();
    this.drafts.clear();
    this.resolved.clear();
    this.doneToday = PERSONA_STATUS[this.persona].doneToday;
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
