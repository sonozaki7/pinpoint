import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateEvenHubPageContainer } from "@evenrealities/even_hub_sdk";
import {
  createDemoInbox, createInboxMorningDeck, createLoginDeck, createPaymentDeck, MockPinpointApi,
} from "../src/mock";
import {
  adoptInbox, applyVoice, chooseOption, clearNotes, doubleTap, finishSend, initialState, moveFocus,
  openDeck, press, previewFailed, recordingOnSurface, recordingTickDelay, setFlash, setPreview, startReview,
  type State,
} from "../src/model";
import {
  asciiTruncate, inboxRow, markerFor, pageFor, pointRow, reviewHeader, toAscii,
} from "../src/display";
import { createLayout, layoutFor } from "../src/even";
import { decodeInput } from "../src/events";
import {
  List_ItemEvent, MenuItemClickEvent, OsEventTypeList, Sys_ItemEvent, Text_ItemEvent,
} from "@evenrealities/even_hub_sdk";
import { LINE_HEIGHT, ROW_MAX_PX, textWidth } from "../src/textfit";

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

function assertPageFits(page: ReturnType<typeof pageFor>): void {
  for (const box of layoutFor(page).text) {
    if (!box.content.trim()) continue;
    const pad = box.padding ?? (box.border ? 6 : 0);
    const innerW = box.width - 2 * (pad + (box.border ? 1 : 0));
    const innerH = box.height - 2 * (pad + (box.border ? 1 : 0));
    const lines = box.content.split("\n");
    assert.ok(
      lines.length * LINE_HEIGHT <= innerH,
      `${page.kind}/${box.name}: ${lines.length} lines in ${innerH}px`,
    );
    for (const line of lines) {
      assert.ok(
        textWidth(line) <= innerW,
        `${page.kind}/${box.name}: ${textWidth(line)}px > ${innerW}px for ${JSON.stringify(line)}`,
      );
    }
  }
  for (const item of page.list ?? []) {
    assert.ok(textWidth(item) <= 476, `inbox row ${textWidth(item)}px > 476px`);
  }
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
  assert.match(at(0)[0] ?? "", /^> 1 /);
  assert.match(at(0)[1] ?? "", /^ {3}2 /);
  assert.match(at(0)[3] ?? "", /Sign out every customer once/);
  assert.match(at(3)[3] ?? "", /Sign out every customer once/, "focus 4 keeps the first window");
  assert.match(at(3)[3] ?? "", /^> 4 .*CHECK$/, "the focused risky row ends with CHECK");
  assert.match(at(4)[0] ?? "", /Add a test/, "focus 5 scrolls one row");
  assert.match(at(4)[3] ?? "", /Keep the 30-day/, "four visible rows end at point 5");
  assert.match(at(6)[0] ?? "", /Sign out every customer once/);
  assert.match(at(6)[3] ?? "", /Release to all/);
  assert.match(at(7)[0] ?? "", /^ {3}5 /, "only the focused row carries the cursor");
  assert.match(at(7)[3] ?? "", /^> Send review · 7 OK$/);
});

test("the inbox header counts every listed thread and the review header reads as words", () => {
  const inbox = inboxState();
  assert.equal(pageFor(inbox, 1_000).title, "Pinpoint · 3 need you");
  for (const row of pageFor(inbox, 1_000).list ?? []) {
    assert.doesNotMatch(row, /^[!?*><] /, `no leading status symbol: ${row}`);
  }
  let review = reviewState();
  assert.equal(reviewHeader(review), "login-fix · 1 of 7");
  review = { ...review, focus: 3, notes: [{ pointId: "p4", verdict: "object", text: "No" }] };
  assert.equal(reviewHeader(review), "login-fix · 4 of 7 · 1 change");
  review = {
    ...review,
    notes: [...review.notes, { pointId: "p6", verdict: "note", text: "Queue it" }],
  };
  const header = reviewHeader(review);
  assert.equal(header, "login-fix · 4 of 7 · 1 change · 1 note");
  assert.doesNotMatch(header, /objection/);
  const twoChanges = {
    ...review,
    notes: [
      { pointId: "p4", verdict: "object" as const, text: "No" },
      { pointId: "p1", verdict: "object" as const, text: "No" },
    ],
  };
  assert.equal(reviewHeader(twoChanges), "login-fix · 4 of 7 · 2 changes");
  const longTitle = {
    ...review,
    deck: { ...review.deck!, title: "a-very-long-thread-title-that-does-not-fit" },
  };
  const fitted = reviewHeader(longTitle);
  assert.ok(textWidth(fitted) <= 544, fitted);
  assert.match(fitted, /\.\.\. · 4 of 7 · 1 change · 1 note$/);
});

test("the focused row is brighter and carries the only cursor", () => {
  const state = { ...reviewState(), focus: 2 };
  const page = pageFor(state, 1_000);
  const focused = page.rows.filter((row) => row.text.startsWith("> "));
  assert.equal(focused.length, 1);
  assert.equal(focused[0]?.brightness, 4);
  for (const row of page.rows.filter((entry) => entry !== focused[0])) {
    assert.equal(row.brightness, 2, row.text);
    assert.match(row.text, /^ {3}/, row.text);
    assert.ok(textWidth(row.text) <= ROW_MAX_PX, row.text);
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
  assert.equal(pageFor(state, 1_000).title, "Pinpoint · 2 need you");
  const { items } = await api.inbox();
  state = adoptInbox(state, items, { demo: false, offline: false });
  assert.equal(state.inbox.length, 2);
  assert.equal(state.inbox.some((entry) => entry.threadId === "login-fix"), false);
});

test("rows use words instead of status glyphs", () => {
  let state = reviewState();
  const deck = state.deck;
  assert.ok(deck);
  const p4 = deck.points[3];
  const p6 = deck.points[5];
  assert.ok(p4 && p6);
  // The old helper stays available for other callers.
  assert.equal(markerFor(p4, { ...state, seen: [] }), "o");
  assert.equal(markerFor(p4, { ...state, seen: ["p4"] }), "+");
  assert.match(pointRow(p4, state), /^ {3}4 .*CHECK$/, "a risky row asks for a check");
  state = { ...state, notes: [{ pointId: "p4", verdict: "object", text: "No" }] };
  assert.equal(markerFor(p4, state), "x");
  assert.match(pointRow(p4, state), /^ {3}4 .*CHANGE$/, "an objection reads as CHANGE");
  state = { ...state, notes: [{ pointId: "p6", verdict: "note", text: "Queue it" }] };
  assert.equal(markerFor(p6, state), "*");
  assert.match(pointRow(p6, state), /^ {3}6 .*NOTE$/);
  const flagged = { ...p4, risk: undefined, flag: "busy Tue" };
  assert.match(pointRow(flagged, { ...state, notes: [] }), /^ {3}4 .*CHECK$/, "a flag asks for a check too");
  const question = reviewState("payment-upgrade");
  const questionPoint = question.deck?.points[0];
  assert.ok(questionPoint);
  assert.equal(markerFor(questionPoint, question), "?");
  const answered = chooseOption({ ...question, screen: "options", optionsFocus: 0 }, 0, 2_000);
  assert.match(pointRow(questionPoint, answered), /Wait until Monday$/);
  assert.equal(nodeLength(createLayout(pageFor(reviewState(), 1_000))), 8);
});

function nodeLength(layout: ReturnType<typeof createLayout>): number {
  return (layout.textObject?.length ?? 0) + (layout.listObject?.length ?? 0);
}

test("labels are ASCII, never cut a short title, and fit by pixels", () => {
  assert.ok(asciiTruncate("x".repeat(100)).length <= 56);
  assert.ok(asciiTruncate("x".repeat(100)).endsWith("..."));
  assert.equal(asciiTruncate("short"), "short");
  assert.equal(asciiTruncate("login-fix"), "login-fix");
  assert.equal(toAscii("Café — ok · ✓"), "Cafe - ok · +");
  assert.equal(toAscii("login-fix"), "login-fix");
  assert.equal(textWidth("login-fix"), 75, "firmware glyph width");
  assert.equal(textWidth("Reproduce the bug with two open tabs"), 333);
  assert.equal(textWidth("·"), 5, "the middle dot is in the G2 font");
  const long = "W".repeat(80);
  const row = asciiTruncate(`o 1 ${long}`);
  assert.ok(textWidth(row) <= ROW_MAX_PX, row);
  assert.match(row, /^[\x20-\x7e·]+$/);
  const listRow = inboxRow({
    threadId: "t", title: "a-very-long-thread-name-that-would-overflow-the-list",
    project: "", attention: "plan", summary: "plan, 7 steps",
    updatedAt: "", deckReady: true, pointCount: 7, draftNotes: 0,
  });
  assert.ok(textWidth(listRow) <= 476, listRow);
});

test("voice notes show as the user's words and answers keep the chosen option", () => {
  const base = reviewState();
  const state = { ...base, focus: 3 };
  const objection = applyVoice(state, "No, keep existing sessions instead.", 1_000);
  assert.equal(objection.notes[0]?.verdict, "object");
  assert.equal(objection.notes[0]?.pointId, "p4");
  assert.match(pageFor(objection, 1_000).pane ?? "", /^You said: No, keep existing sessions instead\.$/);
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
  assert.match(pageFor(picked, 4_000).pane ?? "", /^You chose: Upgrade in a test shop$/);
  assert.match(pointRow(question.deck!.points[0]!, picked), /Upgrade in a test shop$/);

  const cleared = clearNotes(answered, 5_000);
  assert.equal(cleared.notes.length, 0);
  assert.match(cleared.flash?.text ?? "", /Notes cleared/);
});

test("the screen flow starts a recording, opens options, previews and sends on a double tap", () => {
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
  assert.equal(pageFor(loaded, 1_000).pane, "3 changes, 4 agreed\nDouble-tap to send");
  const back = press(loaded, 2_000);
  assert.equal(back.state.screen, "review", "a single tap leaves the preview");
  assert.equal(back.effect, undefined);
  const sending = doubleTap(loaded);
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
  const sample = { ...inboxState(), workspace: "sample" } as State;
  const empty = adoptInbox(initialState({ demo: true, loading: false }), [], {
    demo: true,
    offline: false,
  });
  const offline = { ...inboxState(), offline: true, offlineMessage: "Can't reach Pinpoint Cloud." };
  const recording = { ...reviewState(), recordingStartedAt: 500 };
  const sendRow = press({ ...reviewState(), focus: 7 }, 1_000).state;
  const loadedPreview = setPreview(sendRow, {
    message: "m", preview: ["1 change, 6 agreed", "Double-tap to send"],
    counts: { objections: 0, answers: 0, notes: 1, agreed: 6 },
  });
  const pages = [
    pageFor(inboxState(), 1_000),
    pageFor(sample, 1_000),
    pageFor(empty, 1_000),
    pageFor({ ...empty, workspace: "sample" }, 1_000),
    pageFor(offline, 1_000),
    pageFor(initialState({ demo: true, loading: true }), 1_000),
    pageFor(setFlash(inboxState(), "Agent replied", 1_000, 3_000), 2_000),
    pageFor(reviewState(), 1_000),
    pageFor({ ...reviewState(), focus: 3 }, 1_000),
    pageFor(press(reviewState("payment-upgrade"), 1_000).state, 1_000),
    pageFor(sendRow, 1_000),
    pageFor(loadedPreview, 1_000),
    pageFor({ ...loadedPreview, sent: true }, 1_000),
    pageFor({ ...loadedPreview, sent: true, workspace: "sample" }, 1_000),
    pageFor(previewFailed(loadedPreview, "Can't reach Pinpoint Cloud. Try again.", 1_000), 1_000),
    pageFor(recording, 3_500),
    pageFor({ ...reviewState(), deck: null, deckError: "Still building. Tap to retry." }, 1_000),
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
    assertPageFits(page);
  }
  const pane = layoutFor(pageFor(reviewState(), 1_000)).text.find((box) => box.name === "pane");
  assert.equal(pane?.height, 90, "three option lines fit the question pane");
});

test("the longest fixture glances and notes still fit their containers", () => {
  const decks = [createLoginDeck(), createPaymentDeck(), createInboxMorningDeck()];
  for (const deck of decks) {
    const state = reviewState(deck.threadId);
    const titled = { ...state, deck };
    for (let focus = 0; focus <= deck.points.length; focus++) {
      assertPageFits(pageFor({ ...titled, focus }, 1_000));
    }
  }
  const longNote = "This is a deliberately long note that keeps going past the pane and must wrap cleanly without ever spilling outside the container. ".repeat(2);
  assertPageFits(pageFor(applyVoice({ ...reviewState(), focus: 3 }, longNote, 1_000), 1_000));
});

test("a foreground change cancels a recording and the clock ticks once a second", () => {
  const recording = { ...reviewState(), recordingStartedAt: 1_000 };
  assert.equal(recordingOnSurface(recording).discard, true);
  assert.equal(recordingOnSurface(recording).state.recordingStartedAt, null);
  const idle = reviewState();
  const idleResult = recordingOnSurface(idle);
  assert.equal(idleResult.discard, false);
  assert.equal(idleResult.state, idle, "idle stays untouched");

  assert.equal(recordingTickDelay(1_000, 1_000), 1_030);
  assert.equal(recordingTickDelay(1_500, 1_000), 530);
  assert.equal(recordingTickDelay(2_000, 1_000), 1_030);
  assert.equal(recordingTickDelay(20_900, 1_000), 100);
  assert.equal(recordingTickDelay(21_000, 1_000), 0);

  const paneAt = (now: number) => pageFor(recording, now).pane;
  assert.equal(paneAt(1_000), "Recording 0s · tap to stop");
  assert.equal(paneAt(1_500), "Recording 0s · tap to stop", "the clock does not move twice in one second");
  assert.equal(paneAt(2_000), "Recording 1s · tap to stop");
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
  // A bare sys event is a tap; the host omits the protobuf zero for CLICK and
  // may also omit eventSource on real hardware. It must never be dropped.
  assert.deepEqual(decodeInput({ sysEvent: new Sys_ItemEvent({}) }), { kind: "tap", listIndex: undefined });
  assert.deepEqual(
    decodeInput({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.LONG_PRESS_EVENT }) }),
    { kind: "hold", phase: "start" },
  );
  assert.deepEqual(
    decodeInput({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT }) }),
    { kind: "hold", phase: "release" },
  );
  assert.deepEqual(
    decodeInput({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SYSTEM_EXIT_EVENT, systemExitReasonCode: 2 }) }),
    { kind: "exit", reason: 2, abnormal: false },
  );
  assert.deepEqual(
    decodeInput({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.ABNORMAL_EXIT_EVENT }) }),
    { kind: "exit", reason: 0, abnormal: true },
  );
  assert.deepEqual(decodeInput({ menuItemClickEvent: new MenuItemClickEvent({ itemID: 3 }) }), { kind: "menu", id: 3 });
  // The first list row is documented to omit its index; that means row 0.
  assert.deepEqual(decodeInput({ listEvent: new List_ItemEvent({}) }), { kind: "tap", listIndex: 0, fromList: true });
  assert.deepEqual(
    decodeInput({ listEvent: new List_ItemEvent({ currentSelectItemIndex: 2, eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT }) }),
    { kind: "down", listIndex: 2, fromList: true },
  );
});

test("a list tap without an index opens the highlighted row, not a stale one", () => {
  const inbox = { ...inboxState(), inboxFocus: 2 };
  const click = decodeInput({ listEvent: new List_ItemEvent({}) });
  assert.deepEqual(click, { kind: "tap", listIndex: 0, fromList: true });
  const opened = press(inbox, 1_000, click.kind === "tap" ? click.listIndex : undefined);
  assert.deepEqual(opened.effect, { type: "open", index: 0 });
  const direct = press(inbox, 1_000, 2);
  assert.deepEqual(direct.effect, { type: "open", index: 2 });
  const stale = press(inbox, 1_000);
  assert.deepEqual(stale.effect, { type: "open", index: 2 }, "direct model callers keep the current highlight");
});
