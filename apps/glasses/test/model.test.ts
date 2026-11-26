import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateEvenHubPageContainer } from "@evenrealities/even_hub_sdk";
import {
  createDemoInbox, createLoginDeck, createPaymentDeck, MockPinpointApi,
} from "../src/mock";
import {
  adoptInbox, applyVoice, chooseOption, clearNotes, finishSend, initialState, moveFocus, openDeck,
  press, setPreview, startReview, type State,
} from "../src/model";
import { asciiTruncate, markerFor, pageFor, reviewHeader, toAscii } from "../src/display";
import { createLayout } from "../src/even";
import { decodeInput } from "../src/events";
import { Text_ItemEvent, Sys_ItemEvent, OsEventTypeList, MenuItemClickEvent, List_ItemEvent } from "@evenrealities/even_hub_sdk";

function inboxState(): State {
  return adoptInbox(initialState({ demo: true, loading: false }), createDemoInbox(), {
    demo: true,
    offline: false,
  });
}

function reviewState(threadId = "login-fix"): State {
  const state = inboxState();
  const item = state.inbox.find((entry) => entry.threadId === threadId);
  assert.ok(item);
  const deck = threadId === "login-fix" ? createLoginDeck() : createPaymentDeck();
  return openDeck(startReview(state, item), deck);
}

test("focus moves one point at a time and stops at the send row", () => {
  let state = reviewState();
  assert.equal(state.focus, 0);
  for (let i = 0; i < 12; i++) state = moveFocus(state, 1);
  assert.equal(state.focus, 7, "seven points plus the send row");
  state = moveFocus(state, -1);
  assert.equal(state.focus, 6);
  state = moveFocus(state, -20);
  assert.equal(state.focus, 0);
});

test("the four-row window scrolls only after the fourth row", () => {
  let state = reviewState();
  const at = (focus: number) => {
    state = { ...state, focus };
    return pageFor(state, 1_000).rows.map((row) => row.text);
  };
  assert.deepEqual(at(0).map((row) => row.slice(0, 3)), ["> +", "  o", "  o", "  !"]);
  assert.match(at(0)[3] ?? "", /Sign out every customer once/);
  assert.match(at(3)[3] ?? "", /Sign out every customer once/, "focus 4 keeps the first window");
  assert.match(at(3)[3] ?? "", /^> !o 4 /, "the focused row carries the brightness cursor");
  assert.match(at(4)[0] ?? "", /Add a test/, "focus 5 scrolls one row");
  assert.match(at(4)[3] ?? "", /Keep the 30-day/, "four visible rows end at point 5");
  assert.match(at(6)[0] ?? "", /Sign out every customer once/);
  assert.match(at(6)[3] ?? "", /Release to all/);
  assert.deepEqual(
    at(7).slice(0, 3).map((row) => row.slice(0, 3)),
    ["  o", "  o", "  o"],
    "only the focused row carries the cursor",
  );
  assert.match(at(7)[3] ?? "", /^> Send review \(0 notes\)/);
});

test("the inbox header counts every listed thread and review counters read as words", () => {
  const inbox = inboxState();
  assert.equal(pageFor(inbox, 1_000).title, "PINPOINT | 3 need you");
  let review = reviewState();
  assert.equal(reviewHeader(review), "login-fix | 1/7");
  review = { ...review, focus: 3, notes: [{ pointId: "p4", verdict: "object", text: "No" }] };
  assert.equal(reviewHeader(review), "login-fix | 4/7 | 1 objection");
  review = {
    ...review,
    notes: [...review.notes, { pointId: "p6", verdict: "note", text: "Queue it" }],
  };
  const header = reviewHeader(review);
  assert.ok(header.length <= 44, header);
  assert.match(header, /^login-fix \| 4\/7 \| 1 objection, 1 note$/);
  const longTitle = {
    ...review,
    deck: { ...review.deck!, title: "a-very-long-thread-title-that-does-not-fit" },
  };
  const fitted = reviewHeader(longTitle);
  assert.ok(fitted.length <= 44, fitted);
  assert.match(fitted, /\.\.\. \| 4\/7 \| 1 objection, 1 note$/);
});

test("the focused row is brighter and carries the only cursor", () => {
  const state = { ...reviewState(), focus: 2 };
  const page = pageFor(state, 1_000);
  const focused = page.rows.filter((row) => row.text.startsWith("> "));
  assert.equal(focused.length, 1);
  assert.equal(focused[0]?.brightness, 4);
  for (const row of page.rows.filter((entry) => entry !== focused[0])) {
    assert.equal(row.brightness, 2, row.text);
    assert.match(row.text, /^ {2}/, row.text);
  }
});

test("a sent thread stays gone when the demo server still lists it", async () => {
  const api = new MockPinpointApi();
  let state = inboxState();
  const item = state.inbox.find((entry) => entry.threadId === "login-fix");
  assert.ok(item);
  state = openDeck(startReview(state, item), createLoginDeck());
  state = finishSend({ ...state, focus: 7 });
  assert.equal(state.inbox.some((entry) => entry.threadId === "login-fix"), false);
  assert.equal(pageFor(state, 1_000).title, "PINPOINT | 2 need you");
  const { items } = await api.inbox();
  state = adoptInbox(state, items, { demo: false, offline: false });
  assert.equal(state.inbox.length, 2);
  assert.equal(state.inbox.some((entry) => entry.threadId === "login-fix"), false);
});

test("markers cover unseen, seen, objection, note, question, answer and high risk", () => {
  let state = reviewState();
  const deck = state.deck;
  assert.ok(deck);
  const p4 = deck.points[3];
  const p6 = deck.points[5];
  assert.ok(p4 && p6);
  assert.equal(markerFor(p4, { ...state, seen: [] }), "o");
  assert.equal(markerFor(p4, { ...state, seen: ["p4"] }), "+");
  assert.equal(markerFor(p4, state), "o");
  assert.match(pageFor(state, 1_000).rows[3]?.text ?? "", /^  !o 4 /, "high-risk marker comes first");
  state = { ...state, notes: [{ pointId: "p4", verdict: "object", text: "No" }] };
  assert.equal(markerFor(p4, state), "x");
  assert.match(pageFor(state, 1_000).rows[3]?.text ?? "", /^  !x 4 /);
  state = { ...state, notes: [{ pointId: "p6", verdict: "note", text: "Queue it" }] };
  assert.equal(markerFor(p6, state), "*");
  const question = reviewState("payment-upgrade");
  const questionPoint = question.deck?.points[0];
  assert.ok(questionPoint);
  assert.equal(markerFor(questionPoint, question), "?");
  assert.equal(markerFor(questionPoint, { ...question, notes: [{ pointId: "p1", verdict: "answer", option: "Wait until Monday" }] }), "=");
  assert.equal(nodeLength(createLayout(pageFor(reviewState(), 1_000))), 8);
});

function nodeLength(layout: ReturnType<typeof createLayout>): number {
  return (layout.textObject?.length ?? 0) + (layout.listObject?.length ?? 0);
}

test("labels are ASCII and truncate to 44 characters", () => {
  assert.equal(asciiTruncate("x".repeat(100)).length, 44);
  assert.ok(asciiTruncate("x".repeat(100)).endsWith("..."));
  assert.equal(asciiTruncate("short"), "short");
  assert.equal(toAscii("Café — ok · ✓"), "Cafe - ok | +");
  const long = "W".repeat(80);
  const point = { id: "p1", index: 1, kind: "step" as const, glance: long, quote: long };
  const row = asciiTruncate(`o 1 ${point.glance}`);
  assert.equal(row.length, 44);
  assert.match(row, /\.\.\.$/);
  assert.match(row, /^[\x20-\x7e]+$/);
});

test("voice notes follow the no/stop/instead heuristic and answers use the = marker", () => {
  const base = reviewState();
  const state = { ...base, focus: 3 };
  const objection = applyVoice(state, "No, keep existing sessions instead.", 1_000);
  assert.equal(objection.notes[0]?.verdict, "object");
  assert.equal(objection.notes[0]?.pointId, "p4");
  assert.match(pageFor(objection, 1_000).pane ?? "", /Heard: No, keep existing sessions/);
  assert.equal(objection.drafts["login-fix"]?.notes.length, 1);

  const note = applyVoice(state, "Add a request queue please.", 2_000);
  assert.equal(note.notes[0]?.verdict, "note");
  const serverObjection = applyVoice(state, "Please add tests.", 2_500, "object");
  assert.equal(serverObjection.notes[0]?.verdict, "object", "a server verdict wins over the prefix");

  const question = reviewState("payment-upgrade");
  const answered = applyVoice(question, "Upgrade in a test shop.", 3_000);
  assert.equal(answered.notes[0]?.verdict, "answer");
  assert.equal(markerFor(question.deck!.points[0]!, answered), "=");

  const picked = chooseOption({ ...question, screen: "options", optionsFocus: 2 }, 2, 4_000);
  assert.equal(picked.notes[0]?.option, "Upgrade in a test shop");
  assert.equal(picked.screen, "review");

  const cleared = clearNotes(answered, 5_000);
  assert.equal(cleared.notes.length, 0);
  assert.match(cleared.flash?.text ?? "", /Notes cleared/);
});

test("the screen flow starts a recording, opens options, previews and sends", () => {
  let state = reviewState();
  state = { ...state, focus: 3 };
  const start = press(state, 1_000);
  assert.equal(start.effect?.type, "record-start");
  assert.equal(start.state.recordingStartedAt, 1_000);
  const stop = press(start.state, 4_000);
  assert.equal(stop.effect?.type, "record-stop");
  assert.equal(stop.state.recordingStartedAt, 1_000, "the recorder stays open until the transcript arrives");

  const options = press(reviewState("payment-upgrade"), 1_000);
  assert.equal(options.state.screen, "options");
  assert.equal(options.effect, undefined);
  assert.equal(pageFor(options.state, 1_000).rows.length, 4);
  const sayElse = press({ ...options.state, optionsFocus: 3 }, 2_000);
  assert.equal(sayElse.state.screen, "review");
  assert.equal(sayElse.effect?.type, "record-start");

  let send = reviewState();
  send = { ...send, focus: 7 };
  const preview = press(send, 1_000);
  assert.equal(preview.state.screen, "preview");
  assert.equal(preview.effect?.type, "preview");
  const loaded = setPreview(preview.state, {
    message: "m", preview: ["2 objections, 1 note", "Tap to send to login-fix"],
    counts: { objections: 2, answers: 0, notes: 1, agreed: 4 },
  });
  assert.equal(pageFor(loaded, 1_000).pane, "2 objections, 1 note\nTap to send to login-fix");
  const sending = press(loaded, 2_000);
  assert.equal(sending.effect?.type, "send");
  assert.equal(sending.state.sending, true);
});

test("the in-memory API serves the plain-language sample threads and composes a review", async () => {
  const api = new MockPinpointApi();
  const { items } = await api.inbox();
  assert.deepEqual(items.map((item) => item.threadId), [
    "payment-upgrade", "login-fix", "inbox-morning",
  ]);
  const deck = await api.deck("login-fix");
  assert.equal(deck.points.length, 7);
  assert.equal(deck.points[3]?.risk, "high");
  assert.match(deck.points[5]?.glance ?? "", /Release to 5%/);
  const result = await api.preview("login-fix", {
    threadId: "login-fix", sourceMessageId: deck.sourceMessageId, updatedAt: "",
    seen: ["p1"],
    notes: [
      { pointId: "p4", verdict: "object", text: "No. Migrate existing sessions." },
      { pointId: "p6", verdict: "object", text: "Use a request queue." },
    ],
  });
  assert.deepEqual(result.preview, ["2 objections, 5 agreed", "Tap to send to login-fix"]);
  assert.match(result.message, /Go ahead with the rest of the plan/);
  assert.equal((await api.voice(new Uint8Array(0))).text.length > 0, true);
  const health = await api.health();
  assert.equal(health.mode, "demo");
  await api.send("login-fix");
  assert.equal((await api.inbox()).items.length, 2);
  await api.resetSample();
  assert.equal((await api.inbox()).items.length, 3);
});

test("every page fits the 576x288 frame with exactly one capture target and a menu", () => {
  const pages = [
    pageFor(inboxState(), 1_000),
    pageFor(reviewState(), 1_000),
    pageFor(press(reviewState("payment-upgrade"), 1_000).state, 1_000),
    pageFor(press({ ...reviewState(), focus: 7 }, 1_000).state, 1_000),
    pageFor(adoptInbox(initialState({ demo: true, loading: false }), [], { demo: true, offline: false }), 1_000),
    pageFor({ ...inboxState(), workspace: "sample" }, 1_000),
    pageFor({ ...reviewState(), workspace: "sample" }, 1_000),
    pageFor(adoptInbox({ ...inboxState(), workspace: "sample" }, [], { demo: false, offline: false }), 1_000),
  ];
  for (const page of pages) {
    const layout = createLayout(page);
    const check = validateEvenHubPageContainer(layout);
    assert.equal(check.valid, true, `${page.kind}: invalid layout`);
    const text = layout.textObject ?? [];
    const list = layout.listObject ?? [];
    assert.equal(text.length + list.length <= 8, true, `${page.kind} container budget`);
    assert.equal([...text, ...list].filter((box) => box.isEventCapture === 1).length, 1, page.kind);
    for (const box of [...text, ...list]) {
      assert.ok((box.xPosition ?? 0) + (box.width ?? 0) <= 576, page.kind);
      assert.ok((box.yPosition ?? 0) + (box.height ?? 0) <= 288, page.kind);
    }
    assert.ok((layout.menuObject?.menuItems?.length ?? 0) > 0, `${page.kind} carries its menu`);
  }
});

test("clicks, swipes, double clicks and menu selections normalize across envelopes", () => {
  assert.deepEqual(decodeInput({ textEvent: new Text_ItemEvent({}) }), { kind: "tap", listIndex: undefined });
  assert.deepEqual(
    decodeInput({ textEvent: new Text_ItemEvent({ eventType: OsEventTypeList.SCROLL_TOP_EVENT }) }),
    { kind: "up", listIndex: undefined },
  );
  assert.deepEqual(
    decodeInput({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }) }),
    { kind: "double" },
  );
  assert.equal(decodeInput({ sysEvent: new Sys_ItemEvent({}) }), undefined);
  assert.deepEqual(decodeInput({ menuItemClickEvent: new MenuItemClickEvent({ itemID: 3 }) }), { kind: "menu", id: 3 });
  assert.deepEqual(
    decodeInput({ listEvent: new List_ItemEvent({ currentSelectItemIndex: 2, eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT }) }),
    { kind: "down", listIndex: 2 },
  );
});
