import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SAMPLE_HEADER, type InboxItem } from "../../../shared/contract";
import { inboxSummary } from "../../../shared/summary";
import { HttpPinpointApi } from "../src/api";
import {
  adoptInbox, applyAsk, applyHealth, applyTask, applyVoice, beginAsk, beginAskLoading, beginTask,
  beginTaskTranscribing, doubleTap, finishSend, initialState, moveFocus, openDeck, press,
  recordingOnSurface, setPersona, startMarkSeen, startReview, taskDue, taskHeard, TASK_HOLD_MS,
  wearChanged, type State,
} from "../src/model";
import { inboxTitle, MENU, pageFor, personaForMenu, reviewHeader, statusVariants } from "../src/display";
import { catchUpFixture, EVERYDAY_FIXTURES, MOCK_QUESTIONS, SAMPLE_FIXTURES } from "../src/mock-fixtures";
import { MockPinpointApi } from "../src/mock";
import { layoutFor } from "../src/even";
import { LINE_HEIGHT, textWidth } from "../src/textfit";

/** Drives the real state machine against the offline mock, counting every gesture. */
class Device {
  state: State;
  now = 1_000;
  tally = { taps: 0, scrolls: 0, holds: 0, voices: 0 };
  readonly api: MockPinpointApi;

  private constructor(api: MockPinpointApi, state: State) {
    this.api = api;
    this.state = state;
  }

  static async boot(options: { sample?: boolean; persona?: "mixed" | "developer" | "everyday" } = {}) {
    const api = new MockPinpointApi({ extended: true, ...options });
    const inbox = await api.inbox();
    let state = adoptInbox(initialState({ demo: true, loading: false }), inbox.items, {
      demo: true,
      offline: false,
      status: inbox.status ?? null,
    });
    state = applyHealth(state, await api.health());
    return new Device(api, { ...state, persona: options.persona ?? "mixed" });
  }

  page() {
    return pageFor(this.state, this.now);
  }

  focusInbox(threadId: string) {
    const index = this.state.inbox.findIndex((item) => item.threadId === threadId);
    assert.ok(index >= 0, `${threadId} is in the inbox`);
    this.state = { ...this.state, inboxFocus: index };
  }

  scroll(delta = 1) {
    this.tally.scrolls++;
    this.state = moveFocus(this.state, delta);
    this.now += 300;
  }

  /** One tap, with whatever the app would do next. */
  async tap(): Promise<void> {
    this.tally.taps++;
    const result = press(this.state, this.now);
    this.state = result.state;
    switch (result.effect?.type) {
      case "open": {
        const item = this.state.inbox[result.effect.index];
        assert.ok(item, "row exists");
        this.state = startReview(this.state, item);
        const deck = await this.api.deck(item.threadId);
        assert.ok(!("pending" in deck));
        this.state = openDeck(this.state, deck);
        break;
      }
      case "mark-seen": {
        const threadId = this.state.deck?.threadId;
        assert.ok(threadId);
        const sent = await this.api.send(threadId);
        assert.equal(sent.ok, true);
        this.state = finishSend(this.state);
        break;
      }
      case "task-start": {
        const text = this.state.task?.text ?? "";
        this.state = applyTask(this.state, await this.api.task(text), this.now);
        break;
      }
      case "record-stop":
        throw new Error("voice stops by itself in these tests");
      default:
    }
  }

  /** Hold opens the menu; choosing an entry is the tap. */
  async hold(label: string): Promise<void> {
    this.tally.holds++;
    const entry = this.page().menu.find((candidate) => candidate.label === label);
    assert.ok(entry, `"${label}" is in the hold menu: ${this.page().menu.map((e) => e.label).join(", ")}`);
    this.tally.taps++;
    switch (entry.id) {
      case MENU.ask:
        this.state = beginAsk(this.state, this.now);
        break;
      case MENU.newTask:
        this.state = beginTask(this.state, this.now);
        break;
      case MENU.markSeen: {
        const item = this.state.inbox[this.state.inboxFocus];
        assert.ok(item);
        this.state = startMarkSeen(this.state, item);
        await this.api.send(item.threadId);
        this.state = finishSend(this.state);
        break;
      }
      default:
        throw new Error(`menu entry ${label} is not driven here`);
    }
  }

  /** One spoken sentence while a recording is open; silence ends it by itself. */
  async speak(purpose: "note" | "ask" | "task"): Promise<void> {
    assert.notEqual(this.state.recordingStartedAt, null, "a recording is open");
    this.tally.voices++;
    const threadId = this.state.deck?.threadId;
    const point = this.state.deck?.points[this.state.focus];
    this.state = { ...this.state, recordingStartedAt: null };
    if (purpose === "task") {
      this.state = beginTaskTranscribing(this.state);
      const heard = await this.api.voice(undefined, undefined, "task");
      this.state = taskHeard(this.state, heard.text, this.now);
    } else if (purpose === "ask") {
      this.state = beginAskLoading(this.state);
      const heard = await this.api.voice(undefined, threadId ? { threadId } : undefined, "ask");
      const answer = await this.api.ask(threadId!, heard.text);
      this.state = applyAsk(this.state, heard.text, answer);
    } else {
      const heard = await this.api.voice(undefined, threadId && point ? { threadId, pointId: point.id } : undefined);
      this.state = applyVoice(this.state, heard.text, this.now, heard.verdict);
    }
  }

  async talk(): Promise<void> {
    await this.tap();
    await this.speak("note");
  }

  async settleSend(): Promise<void> {
    const threadId = this.state.deck?.threadId;
    assert.equal(this.state.screen, "countdown");
    assert.ok(threadId);
    this.state = finishSend(await this.api.send(threadId).then(() => this.state));
  }
}

function assertFits(page: ReturnType<typeof pageFor>): void {
  for (const box of layoutFor(page).text) {
    if (!box.content.trim()) continue;
    const pad = box.padding ?? (box.border ? 6 : 0);
    const innerW = box.width - 2 * (pad + (box.border ? 1 : 0));
    const innerH = box.height - 2 * (pad + (box.border ? 1 : 0));
    const lines = box.content.split("\n");
    assert.ok(lines.length * LINE_HEIGHT <= innerH, `${page.kind}/${box.name}: ${lines.length} lines in ${innerH}px`);
    for (const line of lines) {
      assert.ok(textWidth(line) <= innerW, `${page.kind}/${box.name}: ${textWidth(line)}px > ${innerW}px "${line}"`);
    }
  }
  for (const item of page.list ?? []) assert.ok(textWidth(item) <= 476, `inbox row ${textWidth(item)}px`);
}

// ---- Review: only what needs you ------------------------------------------------------------

test("a long plan collapses to the lines that need you, with the evidence under the quote", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  const page = device.page();
  assert.equal(device.state.focus, 3, "the cursor opens on the first line that needs you");
  assert.equal(page.title, "login-fix · 1 needs you");
  assert.equal(page.rows.length, 3, "the one line that needs you, the routine row, and Send");
  assert.match(page.rows[0]?.text ?? "", /^> 4 Sign out every customer once .*CHECK$/);
  assert.match(page.rows[1]?.text ?? "", /^ {3}\+6 routine · agreed$/);
  assert.match(page.rows[2]?.text ?? "", /^ {3}Send · 7 OK$/);
  assert.match(page.pane ?? "", /^"Sign out every customer once[^]*logins\."\nWhy: /);
  assert.match(page.pane?.split("\n").at(-1) ?? "", /^Why: \S.{10,}/);
  assertFits(page);
});

test("the routine row opens in place with one tap and keeps the order of the plan", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  device.scroll();
  assert.match(device.page().rows[1]?.text ?? "", /^> \+6 routine · agreed$/);
  assert.match(device.page().pane ?? "", /^6 routine points · all agreed\.\nTap to read them\.$/);
  assert.equal(device.page().footer, "Tap: expand · Double-tap: back");
  await device.tap();
  assert.equal(device.state.routineOpen, true);
  assert.equal(device.state.focus, 0, "the cursor starts on the first routine point");
  assert.equal(device.page().title, "login-fix · 1 of 7");
  assert.equal(device.page().rows.length, 4);
  assert.match(device.page().rows[0]?.text ?? "", /^> 1 /);
});

test("a changed point reads 'Changed since your review' and counts as needing you", async () => {
  const device = await Device.boot({ persona: "everyday" });
  device.focusInbox("school-newsletter");
  await device.tap();
  // No shipped fixture has a revised line yet, so mark the concert as changed after it opened.
  const deck = device.state.deck!;
  device.state = {
    ...device.state,
    deck: { ...deck, points: deck.points.map((point) => point.id === "p6" ? { ...point, changed: true } : point) },
  };
  const rows = device.page().rows.map((row) => row.text);
  assert.equal(rows.length, 4, "two lines that need you, the routine row and Send");
  assert.match(rows[0] ?? "", /^> 2 Bake sale: Friday, December 12 .*CHECK$/);
  assert.match(rows[1] ?? "", /^ {3}6 Winter concert: Thursday, Dec 18 .*CHANGED$/);
  assert.match(device.page().pane ?? "", /\nWhy: Bake sale plan says Saturday the 13th$/);
  device.scroll();
  assert.match(device.page().pane ?? "", /\nChanged since your review$/);
});

test("every review pane, row and header fits the glasses by pixels", async () => {
  const device = await Device.boot();
  for (const item of [...device.state.inbox]) {
    device.focusInbox(item.threadId);
    await device.tap();
    for (let step = 0; step < 12; step++) {
      assertFits(device.page());
      device.scroll();
      if (device.state.screen === "options") break;
    }
    device.state = { ...device.state, screen: "inbox", deck: null, reviewKind: "review" };
  }
  assertFits(pageFor(device.state, 1_000));
});

test("a mistake in a routine line costs one extra tap, not a scroll through everything", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap(); // open
  device.scroll(); // to the routine row
  await device.tap(); // expand
  for (let i = 0; i < 5; i++) device.scroll(); // to step 6
  assert.equal(device.state.focus, 5);
  await device.talk(); // tap + one sentence
  assert.equal(device.state.focus, 7, "the cursor lands on Send by itself");
  await device.tap(); // Send -> countdown
  assert.equal(device.state.screen, "countdown");
  assert.equal(device.tally.taps, 4, "open + expand + talk + send");
  assert.equal(device.tally.taps - 3, 1, "one extra tap over a flagged-line fix (3 taps)");
  assert.equal(device.tally.voices, 1);
});

test("a flagged-line fix is still open + talk + send, with the routine row collapsed", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  await device.talk();
  assert.equal(device.state.focus, 7);
  await device.tap();
  assert.deepEqual(device.tally, { taps: 3, scrolls: 0, holds: 0, voices: 1 });
});

// ---- Ask ------------------------------------------------------------------------------------

test("Ask: hold + tap + 1 voice, then the answer and its source sentence", async () => {
  const device = await Device.boot();
  device.focusInbox("saturday-plan");
  await device.tap(); // open: 1 tap (not part of Ask itself)
  const opened = { ...device.tally };
  assert.equal(device.page().menu[0]?.label, "Ask", "Ask is the first item of the hold menu");
  await device.hold("Ask");
  assert.match(device.page().pane ?? "", /^Ask your question · 0s\nTap to stop$/);
  await device.speak("ask");
  assert.deepEqual(
    { taps: device.tally.taps - opened.taps, holds: device.tally.holds, voices: device.tally.voices, scrolls: device.tally.scrolls },
    { taps: 1, holds: 1, voices: 1, scrolls: 0 },
    "Ask = hold + tap + 1 voice",
  );
  const pane = device.page().pane ?? "";
  assert.match(pane, /^A: The science museum from 13:30 to 15:30\./);
  assert.match(pane, /\nFrom: "The science museum from 13:30 to 15:30\."$/);
  assertFits(device.page());
  assert.equal(device.page().footer, "Tap: go to line · Double-tap: back");
});

test("Ask shows 'Looking...' while waiting, and tap jumps to the point, expanding routine rows", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  await device.hold("Ask");
  device.state = { ...device.state, recordingStartedAt: null };
  device.state = beginAskLoading(device.state);
  assert.equal(device.page().pane, "Looking...");
  // The answer sentence lives in a routine point: the jump opens the routine rows.
  const answered = applyAsk(device.state, "Which step releases first?", {
    ok: true,
    answer: "5% of customers first.",
    quote: "Release to 5% of customers first and watch the error rate.",
    pointId: "p6",
  });
  device.state = answered;
  assert.equal(device.state.routineOpen, false);
  await device.tap();
  assert.equal(device.state.ask, null);
  assert.equal(device.state.routineOpen, true);
  assert.equal(device.state.focus, 5, "the cursor is on the point holding the sentence");
  assert.match(device.page().pane ?? "", /^"Release to 5% of customers first/);
});

test("double-tap on an answer returns to the review, not the inbox", async () => {
  const device = await Device.boot();
  device.focusInbox("saturday-plan");
  await device.tap();
  await device.hold("Ask");
  await device.speak("ask");
  const result = doubleTap(device.state);
  assert.equal(result.state.screen, "review");
  assert.equal(result.state.ask, null);
  assert.equal(result.state.deck?.threadId, "saturday-plan");
  // And a second double-tap leaves the review.
  assert.equal(doubleTap(result.state).state.screen, "inbox");
});

test("Ask says so when the output does not answer", async () => {
  const api = new MockPinpointApi({ extended: true });
  const result = await api.ask("saturday-plan", "Is the moon made of cheese?");
  assert.equal(result.ok, false);
  assert.equal(result.answer, "Not in this output.");
  const device = await Device.boot();
  device.focusInbox("saturday-plan");
  await device.tap();
  device.state = applyAsk(device.state, "q", result);
  assert.equal(device.page().pane, "A: Not in this output.");
  assert.equal(device.page().footer, "Tap: close · Double-tap: back");
});

test("every scripted demo question gets a sentence from its own source", async () => {
  const api = new MockPinpointApi({ extended: true });
  for (const [threadId, question] of Object.entries(MOCK_QUESTIONS)) {
    const result = await api.ask(threadId, question);
    assert.ok(result.answer.length > 0, threadId);
    if (result.ok) assert.ok(result.quote, `${threadId} cites its sentence`);
  }
  for (const id of ["login-fix", "saturday-plan", "school-newsletter"]) {
    const result = await api.ask(id, MOCK_QUESTIONS[id]!);
    assert.equal(result.ok, true, id);
    assert.ok(result.pointId, `${id} jumps to a point`);
  }
});

// ---- Glance status -------------------------------------------------------------------------

test("the inbox header is the glance status line, shortened to fit", async () => {
  const device = await Device.boot();
  assert.equal(device.page().title, "Pinpoint · 5 need you · 2 working · 5 done today");
  assert.deepEqual(statusVariants({ needYou: 1, working: 0, doneToday: 9 }), [
    "1 needs you · 0 working · 9 done today",
    "1 needs you · 0 working · 9 done",
    "1 needs you · 0 working",
    "1 needs you",
  ]);
  const status = { needYou: 12, working: 11, doneToday: 123 };
  for (const name of ["Pinpoint", "Sample", "Desk: Sota's very long MacBook Pro name here"]) {
    const title = inboxTitle(name, status, 12);
    assert.ok(textWidth(title) <= 544, `${title} (${textWidth(title)}px)`);
    assert.match(title, /need you/);
  }
  assert.equal(inboxTitle("Sample", { needYou: 0, working: 2, doneToday: 6 }, 0), "Sample · All clear · 2 working · 6 done today");
});

test("sample and desk names stay in the status header", async () => {
  const device = await Device.boot({ sample: true });
  assert.equal(device.state.workspace, "sample");
  assert.equal(device.page().title, "Sample · 5 need you · 2 working · 5 done today");
  const desk = {
    ...device.state,
    workspace: "desk" as const,
    desk: { name: "Sota's Mac", online: true },
  };
  assert.equal(pageFor(desk, 1_000).title, "Sota's Mac · 5 need you · 2 working · 5 done today");
});

test("the catch-up row does not count as work that needs you", async () => {
  const device = await Device.boot();
  const rows = device.page().list ?? [];
  assert.match(rows.at(-1) ?? "", /^Agent {2}Since you looked {2}3 updates · 1 needs you$/);
  const noStatus = { ...device.state, status: null };
  assert.equal(pageFor(noStatus, 1_000).title, "Pinpoint · 5 need you");
});

// ---- Catch-up -------------------------------------------------------------------------------

test("catch-up opens a read-only list; tap on a line with a thread opens that thread", async () => {
  const device = await Device.boot();
  device.focusInbox("since-you-looked");
  await device.tap();
  assert.equal(device.state.reviewKind, "catch-up");
  assert.equal(device.state.focus, 0);
  let page = device.page();
  assert.equal(page.title, "Since you looked · 3 updates");
  assert.match(page.rows[0]?.text ?? "", /^> 1 login-fix: agent replied.* OPEN$/);
  assert.match(page.rows[1]?.text ?? "", /^ {3}2 groceries: ordered for Sunday$/, "its thread is not in the inbox: no OPEN tag");
  assertFits(page);
  assert.equal(page.menu[0]?.label, "Mark seen");
  assert.equal(page.menu.some((entry) => entry.label === "Ask"), false);
  // A tap on a line whose thread is not in the inbox opens nothing.
  device.scroll();
  let result = press(device.state, device.now);
  assert.equal(result.effect, undefined);
  device.scroll(-1);
  page = device.page();
  assert.equal(page.footer, "Tap: open · Double-tap: back");
  assert.match(page.pane ?? "", /\nOpens login-fix$/);
  await device.tap();
  assert.equal(device.state.reviewKind, "review");
  assert.equal(device.state.deck?.threadId, "login-fix");
  assert.equal(device.state.focus, 3, "and it opens on the line that needs you");
  result = doubleTap(device.state);
  assert.equal(result.state.screen, "inbox");
});

test("catch-up lines for threads that are gone say so, and Mark seen is one tap", async () => {
  const device = await Device.boot();
  device.focusInbox("since-you-looked");
  await device.tap();
  // Take the login-fix thread out of the inbox: its line no longer opens anything.
  device.state = { ...device.state, inbox: device.state.inbox.filter((item) => item.threadId !== "login-fix") };
  assert.doesNotMatch(device.page().rows[0]?.text ?? "", /OPEN/);
  const result = press(device.state, device.now);
  assert.equal(result.effect, undefined);
  assert.match(result.state.flash?.text ?? "", /Already handled/);
  // Read to the end: the send row reads "Mark seen".
  for (let i = 0; i < 3; i++) device.scroll();
  assert.equal(device.state.focus, 3);
  assert.match(device.page().rows.at(-1)?.text ?? "", /^> Mark seen$/);
  assert.equal(device.page().footer, "Tap: mark seen · Double-tap: back");
  const before = { ...device.tally };
  await device.tap();
  assert.equal(device.tally.taps - before.taps, 1, "Mark seen = 1 tap");
  assert.equal(device.state.screen, "inbox");
  assert.equal(device.state.inbox.some((item) => item.threadId === "since-you-looked"), false);
});

test("catch-up read budget: open + scrolls, then Mark seen from the inbox is hold + tap", async () => {
  const read = await Device.boot();
  read.focusInbox("since-you-looked");
  await read.tap();
  for (let i = 0; i < 3; i++) read.scroll();
  assert.equal(read.tally.taps, 1, "reading is open + scrolls");
  assert.equal(read.tally.scrolls, 3);
  const quick = await Device.boot();
  quick.focusInbox("since-you-looked");
  assert.equal(quick.page().menu[0]?.label, "Mark seen");
  await quick.hold("Mark seen");
  assert.deepEqual(quick.tally, { taps: 1, scrolls: 0, holds: 1, voices: 0 });
  assert.equal(quick.state.inbox.some((item) => item.threadId === "since-you-looked"), false);
});

// ---- New task -------------------------------------------------------------------------------

test("New task: hold + tap + 1 voice + tap, then back to the inbox", async () => {
  const device = await Device.boot();
  assert.ok(device.page().menu.some((entry) => entry.label === "New task"));
  await device.hold("New task");
  assert.equal(device.state.screen, "task");
  assert.match(device.page().pane ?? "", /^What should I start\? · 0s\nTap to stop$/);
  await device.speak("task");
  const confirm = device.page();
  assert.equal(confirm.title, "New task");
  assert.equal(confirm.pane, "Start: Find a dentist open on Saturday and book me in.");
  assert.equal(confirm.footer, "Tap: start · Double-tap: cancel");
  assertFits(confirm);
  await device.tap();
  const started = device.page();
  assert.equal(started.pane, "Started · Claude.\nYou'll see it when it needs you.");
  assertFits(started);
  assert.deepEqual(device.tally, { taps: 2, scrolls: 0, holds: 1, voices: 1 });
  // The inbox comes back by itself after a moment, with no extra gesture.
  assert.equal(taskDue(device.state, device.now + TASK_HOLD_MS - 1), false);
  assert.equal(taskDue(device.state, device.now + TASK_HOLD_MS), true);
});

test("New task: double-tap cancels before starting and after hearing", async () => {
  const device = await Device.boot();
  await device.hold("New task");
  const recording = doubleTap(device.state);
  assert.equal(recording.state.screen, "inbox");
  assert.equal(recording.state.task, null);
  assert.equal(recording.state.recordingStartedAt, null, "the microphone request is dropped");
  await device.speak("task");
  const cancelled = doubleTap(device.state);
  assert.equal(cancelled.state.screen, "inbox");
  assert.equal(cancelled.state.task, null);
  assert.equal(cancelled.effect, undefined, "nothing is started");
});

test("New task: a failed start shows why, and a tap tries again", async () => {
  const device = await Device.boot();
  await device.hold("New task");
  await device.speak("task");
  device.state = press(device.state, device.now).state;
  device.state = applyTask(device.state, { ok: false, error: "No project is allowed for tasks." }, device.now);
  assert.equal(device.page().pane, "No project is allowed for tasks.");
  assert.equal(device.page().footer, "Tap: try again · Double-tap: cancel");
  const retry = press(device.state, device.now);
  assert.equal(retry.state.task?.phase, "confirm");
  assert.equal(press(retry.state, device.now).effect?.type, "task-start");
});

test("New task: an empty recording returns to the inbox with a hint, and a surface change drops it", async () => {
  const device = await Device.boot();
  await device.hold("New task");
  device.state = beginTaskTranscribing({ ...device.state, recordingStartedAt: null });
  const empty = taskHeard(device.state, "   ", 5_000);
  assert.equal(empty.screen, "inbox");
  assert.match(empty.flash?.text ?? "", /Didn't catch that/);
  const again = await Device.boot();
  await again.hold("New task");
  const surface = recordingOnSurface(again.state);
  assert.equal(surface.discard, true);
  assert.equal(surface.state.screen, "inbox");
  assert.equal(surface.state.task, null);
});

test("the mock picks Codex for code work and Claude for errands", async () => {
  const api = new MockPinpointApi({ extended: true });
  assert.equal((await api.task("Fix the flaky login test and open a PR")).agent, "Codex");
  assert.equal((await api.task("Find a dentist open on Saturday")).agent, "Claude");
  const long = await api.task("Find a dentist open on Saturday morning near the office and book me in");
  assert.ok((long.title ?? "").length <= 30);
  assert.equal((await api.task("  ")).ok, false);
});

// ---- Sample persona -------------------------------------------------------------------------

test("the persona entries exist only in the sample workspace and map back to a persona", async () => {
  const plain = await Device.boot();
  assert.equal(plain.page().menu.some((entry) => entry.label.startsWith("Sample:")), false);
  const sample = await Device.boot({ sample: true });
  const labels = sample.page().menu.map((entry) => entry.label);
  assert.deepEqual(labels.filter((label) => label.startsWith("Sample:")), [
    "Sample: Everyday", "Sample: Developer", "Sample: Mixed (now)",
  ]);
  assert.equal(personaForMenu(MENU.everyday), "everyday");
  assert.equal(personaForMenu(MENU.developer), "developer");
  assert.equal(personaForMenu(MENU.mixed), "mixed");
  assert.equal(personaForMenu(MENU.ask), null);
  const switched = setPersona(sample.state, "everyday");
  assert.equal(switched.persona, "everyday");
  assert.equal(switched.inbox.length, 0, "the inbox reloads from the new story");
  const everyday = pageFor({ ...switched, workspace: "sample" }, 1_000).menu.map((entry) => entry.label);
  assert.ok(everyday.includes("Sample: Everyday (now)"));
});

test("each persona shows its own story", async () => {
  const everyday = await Device.boot({ sample: true, persona: "everyday" });
  assert.deepEqual(everyday.state.inbox.map((item) => item.threadId), [
    "flight-price", "saturday-plan", "landlord-reply", "school-newsletter", "since-you-looked",
  ]);
  const developer = await Device.boot({ sample: true, persona: "developer" });
  assert.deepEqual(developer.state.inbox.map((item) => item.threadId), [
    "payment-upgrade", "login-fix", "draft-priya", "launch-post", "since-you-looked",
  ]);
  const api = new MockPinpointApi({ extended: true, sample: true });
  api.setSample("developer");
  const items = (await api.inbox()).items.map((item) => item.threadId);
  assert.equal(items.includes("saturday-plan"), false);
});

test("a non-default persona is sent as X-Pinpoint-Sample; the default adds no header", async () => {
  const realFetch = globalThis.fetch;
  const seen: Array<string | null> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get(SAMPLE_HEADER));
    return new Response(JSON.stringify({ items: [], updatedAt: "2026-11-27T00:00:00.000Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi("https://pinpoint-api.qolso.com", {
      device: async () => "11111111-1111-4111-8111-111111111111",
      token: async () => null,
    });
    await api.inbox();
    api.setSample("everyday");
    await api.inbox();
    api.setSample("developer");
    await api.inbox();
    api.setSample("mixed");
    await api.inbox();
    assert.deepEqual(seen, [null, "everyday", "developer", null]);
    const saved = new HttpPinpointApi("https://pinpoint-api.qolso.com", {
      device: async () => "11111111-1111-4111-8111-111111111111",
      token: async () => null,
      sample: "everyday",
    });
    await saved.inbox();
    assert.equal(seen.at(-1), "everyday", "the saved choice is sent from the first request");
    // A paired desk is not a sample workspace: its token wins and no story header is sent.
    const paired = new HttpPinpointApi("https://pinpoint-api.qolso.com", {
      device: async () => "11111111-1111-4111-8111-111111111111",
      token: async () => "t".repeat(40),
      sample: "everyday",
    });
    await paired.inbox();
    assert.equal(seen.at(-1), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("POST /api/task sends the words and returns the agent", async () => {
  const realFetch = globalThis.fetch;
  let captured: { url: string; body: string } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), body: String(init?.body) };
    return new Response(JSON.stringify({ ok: true, threadId: "t-1", title: "Find a dentist", agent: "Codex" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi("http://127.0.0.1:8787", { device: async () => "x", deviceHeader: false });
    const result = await api.task("Find a dentist open Saturday");
    assert.deepEqual(captured, {
      url: "http://127.0.0.1:8787/api/task",
      body: JSON.stringify({ text: "Find a dentist open Saturday" }),
    });
    assert.equal(result.agent, "Codex");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- Mock data ------------------------------------------------------------------------------

test("the offline fixtures quote their source exactly and catch-up lines point at real threads", async () => {
  const personas = ["mixed", "developer", "everyday"] as const;
  for (const fixture of [
    ...EVERYDAY_FIXTURES, ...SAMPLE_FIXTURES, ...personas.map((persona) => catchUpFixture(persona)),
  ]) {
    for (const point of fixture.deck.points) {
      assert.ok(fixture.source.text.includes(point.quote), `${fixture.thread.threadId} ${point.id} quote is in the source`);
      assert.ok(point.glance.length <= 44, `${point.id} glance ≤ 44`);
      if (point.flag) assert.ok(point.flag.length <= 24, `${point.id} flag ≤ 24`);
      if (point.why) assert.ok(point.why.length <= 60, `${point.id} why ≤ 60`);
    }
  }
  for (const persona of personas) {
    const api = new MockPinpointApi({ extended: true, persona });
    const lines = catchUpFixture(persona).deck.points;
    assert.ok(lines.length > 0, persona);
    for (const line of lines) {
      assert.ok(line.threadRef, `${persona} ${line.id} points at a thread`);
      await api.deck(line.threadRef!);
    }
  }
});

test("the review header counts what needs you while routine rows are collapsed", async () => {
  const device = await Device.boot({ persona: "everyday" });
  device.focusInbox("school-newsletter");
  await device.tap();
  assert.equal(reviewHeader(device.state), "PTA newsletter · 1 needs you");
  device.state = { ...device.state, notes: [{ pointId: "p2", verdict: "note", text: "Sunday" }] };
  assert.equal(reviewHeader(device.state), "PTA newsletter · 1 needs you · 1 note");
});

test("inbox items for the catch-up carry kind and need no one", async () => {
  const api = new MockPinpointApi({ extended: true });
  const { items, status } = await api.inbox();
  const catchUp = items.find((item): item is InboxItem => item.kind === "catch-up");
  assert.ok(catchUp);
  assert.equal(catchUp.needsYou, 1, "one line is waiting for you, like the server's count");
  assert.equal(catchUp.summary, "3 updates · 1 needs you");
  assert.equal(status?.needYou, items.length - 1, "the catch-up row is news, not work");
});

// ---- Brightness = importance ----------------------------------------------------------------

test("the row that needs you is bright, routine rows are dim, and the review stays within 8 containers", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  const page = device.page();
  assert.deepEqual(page.rows.map((row) => row.brightness), [4, 1, 2], "needs you 4, routine row dimmest, Send 2");
  // Move the cursor onto the routine row: it stays dim, the flagged row stays bright.
  device.scroll();
  assert.deepEqual(device.page().rows.map((row) => row.brightness), [4, 2, 2]);
  await device.tap();
  const open = device.page();
  const flagged = open.rows.find((row) => /CHECK$/.test(row.text));
  assert.equal(flagged?.brightness, 4);
  for (const row of open.rows.filter((entry) => entry !== flagged && !/Send/.test(entry.text))) {
    assert.ok(row.brightness <= 2, `${row.text} is dim`);
  }
  for (const state of [device.state, { ...device.state, routineOpen: false }]) {
    const boxes = layoutFor(pageFor(state, device.now)).text;
    assert.ok(boxes.length <= 8, `${boxes.length} text containers`);
    for (const box of boxes) assert.ok(box.brightness >= 0 && box.brightness <= 4, box.name);
  }
});

test("a noted row reads as handled (3)", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  await device.talk();
  const rows = device.page().rows;
  assert.equal(rows.find((row) => /CHANGE\b|NOTE\b/.test(row.text))?.brightness, 3);
});

// ---- Wear detection -------------------------------------------------------------------------

test("wear: glasses on after off lands on the inbox with status and 'Since you looked', 0 gestures", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  assert.equal(device.state.screen, "review");
  const before = { ...device.tally };
  let result = wearChanged(device.state, true); // the first report only says where the glasses are
  assert.equal(result.effect, undefined);
  assert.equal(result.state.screen, "review");
  result = wearChanged(result.state, false);
  assert.equal(result.effect, undefined, "taking them off asks for nothing");
  result = wearChanged(result.state, true);
  assert.equal(result.effect?.type, "wear-refresh");
  device.state = result.state;
  const page = device.page();
  assert.equal(device.state.screen, "inbox");
  assert.equal(page.title, "Pinpoint · 5 need you · 2 working · 5 done today");
  assert.match(page.subtitle ?? "", /^Since you looked · 3 updates · 1 needs you$/);
  assert.deepEqual(device.tally, before, "no gesture was needed");
  assert.ok(textWidth(page.subtitle ?? "") <= 544);
  // Scrolling keeps it (a header change would rebuild the native list); opening something clears it.
  device.scroll();
  assert.match(device.page().subtitle ?? "", /^Since you looked/);
  await device.tap();
  assert.equal(device.state.welcome, false);
});

test("wear: taking the glasses off mid-recording drops the recording, nothing is sent", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  await device.tap();
  device.state = wearChanged(device.state, true).state;
  await device.tap(); // starts a recording on the flagged line
  assert.notEqual(device.state.recordingStartedAt, null);
  const off = wearChanged(device.state, false);
  assert.equal(off.effect?.type, "record-discard");
  assert.equal(off.state.recordingStartedAt, null);
  assert.equal(off.state.notes.length, 0);
  assert.equal(off.state.asking, false);
  // The same for a spoken question and for a new task.
  const asking = beginAsk(wearChanged(device.state, true).state, 1_000);
  assert.equal(wearChanged(asking, false).state.asking, false);
  const task = await Device.boot();
  await task.hold("New task");
  task.state = wearChanged(wearChanged(task.state, true).state, false).state;
  assert.equal(task.state.recordingStartedAt, null);
  assert.equal(task.state.screen, "inbox", "a cancelled voice task returns to the inbox");
  assert.equal(task.state.task, null);
});

test("wear: a send that is counting down is never interrupted, and the mock brings 'Since you looked' back", async () => {
  const device = await Device.boot();
  device.focusInbox("login-fix");
  device.state = wearChanged(device.state, true).state;
  device.state = wearChanged(device.state, false).state;
  const mid = { ...device.state, screen: "countdown" as const, countdownStartedAt: device.now };
  const result = wearChanged(mid, true);
  assert.equal(result.state.screen, "countdown");
  assert.equal(result.effect?.type, "wear-refresh");

  const api = new MockPinpointApi({ extended: true });
  await api.send("since-you-looked");
  assert.equal((await api.inbox()).items.some((item) => item.kind === "catch-up"), false);
  api.simulateWear(false);
  api.simulateWear(true);
  assert.equal((await api.inbox()).items.some((item) => item.kind === "catch-up"), true);
});

test("mock inbox summaries read exactly like the server's, from the real fixtures", async () => {
  const mixed = new Map((await new MockPinpointApi({ extended: true }).inbox()).items.map((item) => [item.threadId, item]));
  assert.equal(mixed.get("landlord-reply")?.summary, "6 lines · 1 needs you");
  assert.equal(mixed.get("landlord-reply")?.title, "Re: lease renewal");
  assert.equal(mixed.get("saturday-plan")?.summary, "6 steps · 1 needs you");
  assert.equal(mixed.get("launch-post")?.summary, "7 points · 1 needs you");
  const everyday = new Map(
    (await new MockPinpointApi({ extended: true, persona: "everyday" }).inbox()).items.map((item) => [item.threadId, item]),
  );
  assert.equal(everyday.get("school-newsletter")?.summary, "7 points · 1 needs you");
  assert.equal(inboxSummary({ attention: "question" }, [{ kind: "question" }]), "question");
  assert.equal(inboxSummary({ attention: "plan" }, undefined), "plan");
  assert.equal(inboxSummary({ app: "gmail", attention: "report" }, [{ kind: "draft", flag: "x" }, { kind: "draft" }]), "2 lines · 1 needs you");
});
