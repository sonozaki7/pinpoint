// Offline mock data for the everyday stories, the sample threads and the "Since you looked" catch-up.
// There is no hand-written copy here: every thread, deck, line and transcript is read from the same
// files the cloud sample serves (demo/fixtures, demo/sample, demo/fixtures/transcripts.json), so the
// simulator, ?mock=1 and the demo video show exactly what the server shows.
import type { AppId, Deck, Point, ThreadAttention } from "../../../shared/contract";
import type { SamplePersona } from "./model";
import saturdayPlanJson from "../../../demo/fixtures/saturday-plan.json";
import landlordReplyJson from "../../../demo/fixtures/landlord-reply.json";
import schoolNewsletterJson from "../../../demo/fixtures/school-newsletter.json";
import depsUpgradeJson from "../../../demo/fixtures/deps-upgrade.json";
import flakyE2eJson from "../../../demo/fixtures/flaky-e2e.json";
import transcriptsJson from "../../../demo/fixtures/transcripts.json";
import flightPriceJson from "../../../demo/sample/threads/flight-price.json";
import groceriesJson from "../../../demo/sample/threads/groceries.json";
import taxReceiptsJson from "../../../demo/sample/threads/tax-receipts.json";
import catchUpJson from "../../../demo/sample/catch-up.json";
import workspaceJson from "../../../demo/sample/workspace.json";

export interface MockFixture {
  thread: {
    threadId: string;
    title: string;
    project: string;
    attention: ThreadAttention;
    updatedAt: string;
    app?: AppId;
    kind?: "review" | "catch-up";
  };
  /** The source text the deck was built from; Ask answers only from here. */
  source: { text: string };
  deck: Deck;
}

/** demo/sample/threads/*.json may leave the deck's own header out; fill it as the server does. */
function normalise(raw: unknown): MockFixture {
  const entry = raw as {
    thread: MockFixture["thread"];
    source: { sourceMessageId: string; text: string };
    deck: Partial<Deck> & { points: Point[] };
  };
  const { thread, source, deck } = entry;
  return {
    thread: { ...thread },
    source: { text: source.text },
    deck: {
      threadId: thread.threadId,
      sourceMessageId: source.sourceMessageId,
      title: thread.title,
      attention: thread.attention,
      headline: deck.headline ?? thread.title,
      points: deck.points,
      createdAt: deck.createdAt ?? thread.updatedAt,
      splitter: "fixture",
    },
  };
}

const saturdayPlan = normalise(saturdayPlanJson);
const landlordReply = normalise(landlordReplyJson);
const schoolNewsletter = normalise(schoolNewsletterJson);

/** Plan (agent), Gmail draft and Notion page: the everyday story. Order is the story's inbox order. */
export const EVERYDAY_FIXTURES: MockFixture[] = [saturdayPlan, landlordReply, schoolNewsletter];

/** Sample-only threads: only a "Since you looked" line (or a persona list) points at them. */
export const SAMPLE_FIXTURES: MockFixture[] = [
  normalise(flightPriceJson),
  normalise(groceriesJson),
  normalise(taxReceiptsJson),
  normalise(depsUpgradeJson),
  normalise(flakyE2eJson),
];

/** Thread ids in inbox order per persona (demo/sample/workspace.json). */
export const PERSONA_THREADS = workspaceJson.personas as Record<SamplePersona, string[]>;

/** The sample glance numbers per persona: agents running, done today. */
export const PERSONA_STATUS = workspaceJson.status as Record<SamplePersona, { working: number; doneToday: number }>;

export const CATCH_UP_THREAD_ID = "since-you-looked";

interface CatchEntry {
  threadRef: string;
  line: string;
  needsYou?: boolean;
}

const CATCH_LINES = catchUpJson as unknown as Record<SamplePersona, CatchEntry[]>;

/** Lines past this length are cut on the glasses; the sample file already keeps to it. */
const CATCH_UP_MAX = 6;

/**
 * "Since you looked": one line per update, in the persona's own story. Same shape the server builds
 * (apps/server/src/core/activity.ts buildCatchUp): the line is the glance and the quote, a tap opens threadRef.
 */
export function catchUpFixture(persona: SamplePersona): MockFixture {
  const lines = (CATCH_LINES[persona] ?? []).slice(0, CATCH_UP_MAX);
  const text = lines.map((entry) => entry.line).join("\n");
  const sourceMessageId = `catch-up-${persona}`;
  const updatedAt = "2026-11-27T08:55:00.000Z";
  const points: Point[] = lines.map((entry, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    kind: "claim",
    glance: entry.line,
    quote: entry.line,
    threadRef: entry.threadRef,
    ...(entry.needsYou ? { flag: "needs you", why: "The agent is waiting for you" } : {}),
  }));
  return {
    thread: {
      threadId: CATCH_UP_THREAD_ID,
      title: "Since you looked",
      project: "Agents",
      attention: "report",
      updatedAt,
      kind: "catch-up",
    },
    source: { text },
    deck: {
      threadId: CATCH_UP_THREAD_ID,
      sourceMessageId,
      title: "Since you looked",
      attention: "report",
      headline: `${lines.length} update${lines.length === 1 ? "" : "s"} since you looked`,
      points,
      createdAt: updatedAt,
      splitter: "catch-up",
    },
  };
}

/** What a spoken question sounds like in the offline demo, per thread. Each is answered from that thread's own source. */
export const MOCK_QUESTIONS: Record<string, string> = {
  "login-fix": "Why sign out every customer?",
  "payment-upgrade": "What does version 5 fix?",
  "saturday-plan": "When is the science museum?",
  "landlord-reply": "When can I drop off the signed copy?",
  "school-newsletter": "When is the winter concert?",
  "flight-price": "How long does the airline hold this fare?",
  "draft-priya": "What payment terms did we offer?",
  "launch-post": "What does the pricing say?",
  "inbox-morning": "What is on the calendar?",
};

/** The spoken notes the offline demo has, shared with the demo recordings (demo/fixtures/transcripts.json). */
export const MOCK_NOTES: Array<{ threadId: string; pointId: string; text: string }> = transcriptsJson.notes;

export const MOCK_TASK_REQUEST = "Find a dentist open on Saturday and book me in.";
