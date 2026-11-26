import { strict as assert } from "node:assert";
import { test } from "node:test";
import type {
  AppId, Deck, EditResult, Health, InboxItem, Point, PreviewResult, ReviewDraft, SendResult,
  ThreadAttention,
} from "../../../shared/contract";
import type { PinpointApi } from "../src/api";
import {
  adoptInbox, applyEdit, applyVoice, countdownDue, countdownLeft, finishSend, initialState, moveFocus,
  openDeck, press, receiptDue, showReceipt, startCountdown, startInboxCountdown, startReview,
  type State,
} from "../src/model";
import { pageFor, pointRow } from "../src/display";
import { createBudgetInbox, editDraftSentence, MockPinpointApi } from "../src/mock";

/**
 * Interaction budgets from docs/ux-budget.md. These tests drive the real
 * state machine (press/moveFocus/applyVoice/chooseOption) and count every
 * gesture the user makes. The API is a scripted fake; the clock only moves
 * when the test moves it.
 */

function point(index: number, kind: Point["kind"], glance: string, extra: Partial<Point> = {}): Point {
  return {
    id: `p${index}`,
    index,
    kind,
    glance,
    quote: extra.quote ?? `${glance}.`,
    ...extra,
  };
}

function deck(threadId: string, title: string, attention: ThreadAttention, points: Point[]): Deck {
  return {
    threadId,
    sourceMessageId: `${threadId}-source`,
    title,
    attention,
    headline: title,
    points,
    createdAt: "2026-11-27T09:00:00.000Z",
    splitter: "test",
  };
}

function item(
  threadId: string,
  title: string,
  attention: ThreadAttention,
  app?: AppId,
): InboxItem {
  return {
    threadId,
    title,
    project: app ?? "T3",
    attention,
    summary: "test",
    updatedAt: "2026-11-27T09:00:00.000Z",
    deckReady: true,
    pointCount: 0,
    draftNotes: 0,
    ...(app ? { app } : {}),
  };
}

function planDeck(flagged: boolean, threadId = "plan"): Deck {
  const points = [
    point(1, "step", "Reproduce the bug"),
    point(2, "step", "Add a failing test"),
    point(3, "step", "Renew the session once"),
    point(4, "step", "Sign out every customer once", flagged ? { risk: "high", flag: "signs out everyone" } : {}),
    point(5, "step", "Keep the 30-day sign-in"),
    point(6, "step", "Release to 5 percent"),
    point(7, "step", "Release to all"),
  ];
  return deck(threadId, "login-fix", "plan", points);
}

function questionDeck(): Deck {
  return deck("question", "payment-upgrade", "question", [
    point(1, "question", "Upgrade payments now?", {
      options: ["Wait until Monday", "Upgrade now", "Upgrade in a test shop"],
      quote: "Upgrade payments now or after the sale?",
    }),
    point(2, "claim", "v5 fixes rare double-charge"),
  ]);
}

function draftDeck(): Deck {
  return deck("draft-priya", "Draft reply to Priya: contract terms", "report", [
    point(1, "draft", "Thanks for the revised contract"),
    point(2, "draft", "Net-60 payment terms", {
      quote: "We're happy to agree to net-60 payment terms.",
      flag: "notes say net-45",
    }),
    point(3, "draft", "Can invoice from Monday"),
    point(4, "draft", "Legal narrows clause 12"),
    point(5, "draft", "Clause 9 delivery date works"),
    point(6, "draft", "Signed copy by Friday"),
  ]);
}

function notionDeck(): Deck {
  return deck("launch-post", "launch-post", "report", [
    point(1, "claim", "Turns long replies into points"),
    point(2, "claim", "Each point quotes the exact line"),
    point(3, "claim", "Launch week starts with partners"),
    point(4, "claim", "Available to everyone today?", { flag: "check this" }),
    point(5, "claim", "Pricing twelve dollars"),
    point(6, "claim", "Puts your note back in place"),
    point(7, "claim", "Three taps: open, speak, send"),
  ]);
}

class FakeApi implements PinpointApi {
  readonly mode = "demo" as const;
  readonly sends: string[] = [];
  readonly edits: Array<{ threadId: string; pointId: string; text: string }> = [];
  voiceText = "No, change that step.";
  receipt = false;

  constructor(
    private readonly items: InboxItem[],
    private readonly decks: Map<string, Deck>,
  ) {}

  inbox() {
    return Promise.resolve({ items: this.items.map((entry) => ({ ...entry })), updatedAt: "now" });
  }

  health(): Promise<Health> {
    return Promise.resolve({ ok: true, mode: "demo", t3: "off", telegram: "off", splitter: "test" });
  }

  deck(threadId: string) {
    const found = this.decks.get(threadId);
    return found ? Promise.resolve(structuredClone(found)) : Promise.reject(new Error(`no deck ${threadId}`));
  }

  putReview(draft: ReviewDraft) {
    return Promise.resolve(draft);
  }

  preview(threadId: string): Promise<PreviewResult> {
    const found = this.decks.get(threadId);
    if (!found) return Promise.reject(new Error(`no deck ${threadId}`));
    return Promise.resolve({
      message: "m",
      preview: ["m", "m"],
      counts: { objections: 0, answers: 0, notes: 0, agreed: found.points.length },
    });
  }

  send(threadId: string): Promise<SendResult> {
    this.sends.push(threadId);
    return Promise.resolve({
      ok: true,
      delivered: "demo-log",
      ...(this.receipt
        ? { receipt: { lines: [{ app: "t3" as AppId, text: "Review delivered to the agent", ok: true }] } }
        : {}),
    });
  }

  edit(threadId: string, pointId: string, text: string): Promise<EditResult> {
    this.edits.push({ threadId, pointId, text });
    const found = this.decks.get(threadId);
    const target = found?.points.find((entry) => entry.id === pointId);
    if (!target) return Promise.resolve({ ok: false, pointId, before: "", error: "Couldn't change this line" });
    const result = editDraftSentence(target.quote, text);
    return Promise.resolve({
      ok: result.ok,
      pointId,
      before: target.quote,
      ...(result.after !== undefined ? { after: result.after } : {}),
      ...(result.method ? { method: result.method } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  voice(): Promise<{ text: string; verdict?: "object" | "note" }> {
    return Promise.resolve({ text: this.voiceText });
  }

  phone() {
    return Promise.resolve({ ok: true, link: "https://example.test" });
  }

  resetSample() {
    return Promise.resolve();
  }
}

interface Tally {
  taps: number;
  scrolls: number;
  holds: number;
  voices: number;
}

class Session {
  state: State;
  now = 1_000;
  tally: Tally = { taps: 0, scrolls: 0, holds: 0, voices: 0 };

  constructor(
    readonly api: FakeApi,
    items: InboxItem[],
    private readonly decks: Map<string, Deck>,
    focus = 0,
  ) {
    this.state = adoptInbox(initialState({ demo: true, loading: false }), items, {
      demo: true,
      offline: false,
    });
    this.state = { ...this.state, inboxFocus: focus };
  }

  async open(index = this.state.inboxFocus): Promise<void> {
    this.tally.taps++;
    const result = press(this.state, this.now, index);
    this.state = result.state;
    if (result.effect?.type !== "open") throw new Error(`tap did not open row ${index}`);
    const opened = this.state.inbox[result.effect.index];
    if (!opened) throw new Error("row disappeared");
    const found = this.decks.get(opened.threadId);
    if (!found) throw new Error(`no deck for ${opened.threadId}`);
    this.state = startReview(this.state, opened);
    this.state = openDeck(this.state, found);
    await this.flush();
  }

  tap(): void {
    this.tally.taps++;
    const result = press(this.state, this.now);
    this.state = result.state;
  }

  scroll(delta = 1): void {
    this.tally.scrolls++;
    this.state = moveFocus(this.state, delta);
    this.now += 300;
  }

  /** One spoken sentence; recording was started by the tap in `talk`. */
  async talk(text = this.api.voiceText): Promise<void> {
    this.tap();
    if (this.state.recordingStartedAt === null) throw new Error("tap did not start recording");
    this.tally.voices++;
    const heard = await this.api.voice();
    this.state = applyVoice(this.state, text || heard.text, this.now, heard.verdict);
    await this.flush();
  }

  /** Run the server-side edit the real app starts after a draft note. */
  private async flush(): Promise<void> {
    const pending = this.state.pendingEdit;
    if (!pending) return;
    const result = await this.api.edit(pending.threadId, pending.pointId, pending.text);
    this.state = applyEdit(this.state, result);
  }

  /** The countdown and the receipt finish by themselves. */
  async settle(): Promise<void> {
    for (let guard = 0; guard < 30; guard++) {
      if (this.state.screen === "countdown") {
        if (!countdownDue(this.state, this.now)) {
          this.now += 1_000;
          continue;
        }
        const threadId = this.state.deck?.threadId ?? this.state.pendingSend?.threadId;
        if (!threadId) throw new Error("countdown has no thread");
        this.state = showReceipt(this.state, await this.api.send(threadId), this.now);
        continue;
      }
      if (this.state.screen === "receipt") {
        if (!receiptDue(this.state, this.now)) {
          this.now += 1_000;
          continue;
        }
        this.state = finishSend(this.state);
        return;
      }
      return;
    }
    throw new Error("the send never finished");
  }

  async agree(): Promise<void> {
    this.tally.holds++;
    const menu = pageFor(this.state, this.now).menu;
    const entry = menu.find((candidate) => candidate.label === "Agree & send");
    if (!entry) throw new Error("Agree & send is not in the menu");
    const target = this.state.inbox[this.state.inboxFocus];
    if (!target) throw new Error("no focused inbox row");
    this.tally.taps++;
    this.state = startInboxCountdown(this.state, target, this.now);
  }
}

function sessionFor(
  deckUnderTest: Deck,
  app?: AppId,
  extraItems: InboxItem[] = [],
): { session: Session; api: FakeApi; decks: Map<string, Deck> } {
  const first = item(deckUnderTest.threadId, deckUnderTest.title, deckUnderTest.attention, app);
  const items = [
    first,
    ...extraItems,
  ].map((entry, index) => (index === 0
    ? { ...entry, pointCount: deckUnderTest.points.length }
    : entry));
  const decks = new Map<string, Deck>([[deckUnderTest.threadId, deckUnderTest]]);
  const api = new FakeApi(items, decks);
  return { session: new Session(api, items, decks), api, decks };
}

test("agent plan with one flagged mistake: 3 taps + 1 voice", async () => {
  const { session, api } = sessionFor(planDeck(true));
  await session.open();
  assert.equal(session.state.screen, "review");
  assert.equal(session.state.focus, 3, "opens on the flagged step 4");
  await session.talk("Don't sign everyone out. Migrate existing sessions.");
  assert.equal(session.state.focus, 7, "the cursor lands on Send by itself");
  assert.match(pageFor(session.state, session.now).rows.at(-1)?.text ?? "", /^> Send · 1 change, 6 OK$/);
  session.tap();
  assert.equal(session.state.screen, "countdown");
  await session.settle();
  assert.deepEqual(session.tally, { taps: 3, scrolls: 0, holds: 0, voices: 1 });
  assert.deepEqual(api.sends, ["plan"]);
  assert.ok(session.tally.taps <= 3);
});

test("agent plan with an unflagged step 4: 3 taps + 3 scrolls + 1 voice", async () => {
  const { session, api } = sessionFor(planDeck(false));
  await session.open();
  assert.equal(session.state.focus, 0, "no flags: line 1");
  session.scroll();
  session.scroll();
  session.scroll();
  assert.equal(session.state.focus, 3, "ring scrolled to step 4");
  await session.talk("Use a queue, not a lock.");
  assert.equal(session.state.focus, 7);
  session.tap();
  await session.settle();
  assert.deepEqual(session.tally, { taps: 3, scrolls: 3, holds: 0, voices: 1 });
  assert.deepEqual(api.sends, ["plan"]);
});

test("agent question: 2 taps, recommended option first, send starts by itself", async () => {
  const { session, api } = sessionFor(questionDeck());
  await session.open();
  assert.equal(session.state.screen, "options", "a question opens straight on its options");
  assert.equal(session.state.optionsFocus, 0);
  assert.match(pageFor(session.state, session.now).rows[0]?.text ?? "", /^> 1 Wait until Monday$/);
  session.tap();
  assert.equal(session.state.screen, "countdown", "choosing the last answer starts the countdown");
  await session.settle();
  assert.deepEqual(session.tally, { taps: 2, scrolls: 0, holds: 0, voices: 0 });
  assert.deepEqual(api.sends, ["question"]);
});

test("Gmail draft fix: 3 taps + 1 voice, 'Now:' shown before sending", async () => {
  const { session, api } = sessionFor(draftDeck(), "gmail");
  await session.open();
  assert.equal(session.state.focus, 1, "opens on the flagged sentence");
  await session.talk("Net-45, not net-60.");
  assert.deepEqual(api.edits, [
    { threadId: "draft-priya", pointId: "p2", text: "Net-45, not net-60." },
  ]);
  assert.match(
    pageFor(session.state, session.now).pane ?? "",
    /^Now: We're happy to agree to net-45 payment terms\.$/,
  );
  assert.match(pageFor(session.state, session.now).rows.at(-1)?.text ?? "", /^> Send to Priya · 1 change$/);
  const fixed = session.state.deck?.points.find((entry) => entry.id === "p2");
  assert.ok(fixed);
  assert.match(pointRow(fixed, session.state), /CHANGED$/, "the fixed row is tagged CHANGED");
  session.tap();
  await session.settle();
  assert.deepEqual(session.tally, { taps: 3, scrolls: 0, holds: 0, voices: 1 });
  assert.deepEqual(api.sends, ["draft-priya"]);
});

test("Notion page with one comment: 3 taps + 1 voice", async () => {
  const { session, api } = sessionFor(notionDeck(), "notion");
  await session.open();
  assert.equal(session.state.focus, 3);
  await session.talk("Not everyone today. Say 10% today and everyone by Friday.");
  assert.match(pageFor(session.state, session.now).rows.at(-1)?.text ?? "", /^> Post 1 comment$/);
  session.tap();
  await session.settle();
  assert.deepEqual(session.tally, { taps: 3, scrolls: 0, holds: 0, voices: 1 });
  assert.deepEqual(api.sends, ["launch-post"]);
});

test("'Agree & send' from the inbox is a hold plus a tap, with no deck opened", async () => {
  const plan = planDeck(true, "agree-me");
  const { session, api } = sessionFor(plan);
  const menu = pageFor(session.state, session.now).menu;
  assert.ok(menu.some((entry) => entry.label === "Agree & send"));
  await session.agree();
  assert.equal(session.state.screen, "countdown");
  assert.equal(session.state.deck, null, "the deck was never opened");
  assert.match(pageFor(session.state, session.now).pane ?? "", /^Sending in 5 · Tap to undo$/);
  await session.settle();
  assert.deepEqual(session.tally, { taps: 1, scrolls: 0, holds: 1, voices: 0 });
  assert.deepEqual(api.sends, ["agree-me"]);
});

test("a question row offers no 'Agree & send'", () => {
  const { session } = sessionFor(questionDeck());
  const menu = pageFor(session.state, session.now).menu;
  assert.equal(menu.some((entry) => entry.label === "Agree & send"), false);
});

test("after sending, the inbox cursor is on the next item with no extra gesture", async () => {
  const first = planDeck(true, "a");
  const second = planDeck(true, "b");
  const third = planDeck(true, "c");
  const items = [
    item("a", "a", "plan"),
    item("b", "b", "plan"),
    item("c", "c", "plan"),
  ];
  const decks = new Map<string, Deck>([["a", first], ["b", second], ["c", third]]);
  const api = new FakeApi(items, decks);
  const session = new Session(api, items, decks, 1);
  await session.open();
  session.state = startCountdown(session.state, session.now);
  await session.settle();
  assert.equal(session.state.screen, "inbox");
  assert.deepEqual(session.state.inbox.map((entry) => entry.threadId), ["a", "c"]);
  assert.equal(session.state.inboxFocus, 1);
  assert.equal(session.state.inbox[session.state.inboxFocus]?.threadId, "c");
  assert.deepEqual(api.sends, ["b"]);
  assert.deepEqual(session.tally, { taps: 1, scrolls: 0, holds: 0, voices: 0 }, "no gesture after send");
});

test("tapping during the countdown undoes it and sends nothing", async () => {
  const { session, api } = sessionFor(planDeck(true));
  await session.open();
  await session.talk();
  session.tap();
  assert.equal(session.state.screen, "countdown");
  session.now += 2_000;
  assert.equal(countdownLeft(session.state, session.now), 3);
  session.tap();
  assert.equal(session.state.screen, "review", "tap returns to the review");
  assert.equal(session.state.focus, 7);
  await session.settle();
  assert.deepEqual(api.sends, [], "nothing was sent");
  assert.match(pageFor(session.state, session.now).footer, /Tap: send/);
});

test("the countdown pane updates once a second and the receipt lasts about 2 s", async () => {
  const { session } = sessionFor(planDeck(true));
  await session.open();
  session.state = startCountdown(session.state, session.now);
  assert.equal(pageFor(session.state, session.now).pane, "Sending in 5 · Tap to undo");
  assert.equal(pageFor(session.state, session.now + 999).pane, "Sending in 5 · Tap to undo");
  assert.equal(pageFor(session.state, session.now + 1_000).pane, "Sending in 4 · Tap to undo");
  assert.equal(pageFor(session.state, session.now + 4_999).pane, "Sending in 1 · Tap to undo");
  const receipt = showReceipt(session.state, { ok: true, delivered: "demo-log" }, session.now + 5_000);
  assert.equal(pageFor(receipt, session.now + 5_000).pane, "Sent to the agent.");
  assert.equal(receiptDue(receipt, session.now + 6_999), false);
  assert.equal(receiptDue(receipt, session.now + 7_000), true);
});

test("a send without receipt lines says 'Sent to the agent.'", async () => {
  const { session } = sessionFor(planDeck(true));
  await session.open();
  session.state = startCountdown(session.state, session.now);
  await session.settle();
  assert.equal(session.state.screen, "inbox");
  // The visible receipt during the 2 s window is asserted above; this checks
  // the fallback text itself.
  const receipt = showReceipt(
    { ...session.state, screen: "countdown" },
    { ok: true, delivered: "demo-log" },
    session.now,
  );
  assert.equal(pageFor(receipt, session.now).pane, "Sent to the agent.");
});

test("inbox rows carry the app tag only when the inbox mixes apps", () => {
  const mixed = adoptInbox(initialState({ demo: true, loading: false }), [
    item("mail", "Priya: contract terms", "report", "gmail"),
    item("page", "Launch post", "report", "notion"),
    item("agent", "login-fix", "plan"),
  ], { demo: true, offline: false });
  assert.deepEqual(pageFor(mixed, 1_000).list, [
    "Mail  Priya: contract terms  test",
    "Notion  Launch post  test",
    "Agent  login-fix  test",
  ]);
  const single = adoptInbox(initialState({ demo: true, loading: false }), [
    item("agent", "login-fix", "plan"),
    item("agent2", "payment-upgrade", "question"),
  ], { demo: true, offline: false });
  assert.deepEqual(pageFor(single, 1_000).list, [
    "login-fix  test",
    "payment-upgrade  test",
  ]);
});

test("the mock data covers the mixed inbox and applies the deterministic edit rules", async () => {
  const items = createBudgetInbox();
  assert.deepEqual(
    items.map((entry) => [entry.threadId, entry.app ?? "t3"]),
    [
      ["payment-upgrade", "t3"],
      ["login-fix", "t3"],
      ["draft-priya", "gmail"],
      ["launch-post", "notion"],
      ["inbox-morning", "t3"],
    ],
  );
  const api = new MockPinpointApi({ extended: true });
  const replaced = await api.edit("draft-priya", "p2", "Net-45, not net-60.");
  assert.equal(replaced.ok, true);
  assert.equal(replaced.method, "replace");
  assert.equal(replaced.after, "We're happy to agree to net-45 payment terms.");

  const deleted = await api.edit("draft-priya", "p2", "delete this");
  assert.equal(deleted.ok, true);
  assert.equal(deleted.method, "delete");
  assert.equal(deleted.after, undefined);

  const said = await api.edit("draft-priya", "p2", "say Please confirm by Friday");
  assert.equal(said.ok, true);
  assert.equal(said.method, "say");
  assert.equal(said.after, "Please confirm by Friday.");

  const failed = await api.edit("draft-priya", "p2", "polish this");
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? "", /Couldn't change this line/);
});
