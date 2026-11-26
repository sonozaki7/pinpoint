import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDemoInbox, createLoginDeck, createPaymentDeck } from "../src/mock";
import {
  adoptInbox, canSend, deckFailed, doubleTap, finishSend, goPreview, initialState, markOffline, press,
  setPreview, showReceipt, shouldAcceptSwipe, startReview, type State,
} from "../src/model";
import { pageFor } from "../src/display";
import { rebuildLayout, SerialWrites } from "../src/even";

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
  return {
    ...startReview(state, item),
    deck: threadId === "login-fix" ? createLoginDeck() : createPaymentDeck(),
    loadingThreadId: null,
    reviewThreadId: item.threadId,
  };
}

test("root double tap opens the exit dialog; other screens go back", () => {
  assert.deepEqual(doubleTap(inboxState()).effect, { type: "exit" });

  const review = reviewState();
  assert.equal(doubleTap(review).state.screen, "inbox");

  const options = press(reviewState("payment-upgrade"), 1_000).state;
  assert.equal(options.screen, "options");
  assert.equal(doubleTap(options).state.screen, "review");

  const countdown = press({ ...review, focus: 7 }, 1_000).state;
  assert.equal(countdown.screen, "countdown");
  assert.equal(doubleTap(countdown).state.screen, "review", "double-tap also undoes the send");
  assert.equal(press(countdown, 1_500).state.screen, "review", "a tap undoes the send");

  const sending = { ...countdown, sending: true };
  assert.equal(press(sending, 1_600).state, sending, "a send in flight cannot be backed out");
  assert.equal(doubleTap(sending).state, sending);

  const receipt = showReceipt(countdown, { ok: true, delivered: "demo-log" }, 1_700);
  assert.equal(receipt.screen, "receipt");
  assert.equal(press(receipt, 1_800).state.screen, "inbox", "a tap leaves the receipt early");
  assert.equal(finishSend(receipt).screen, "inbox");
});

test("the legacy preview screen still refuses a send until its preview loads", () => {
  const preview = goPreview(reviewState());
  assert.equal(canSend(preview), false, "an empty preview screen cannot send");
  const loaded = setPreview(preview, {
    message: "m",
    preview: ["1 change, 6 agreed", "Double-tap to send"],
    counts: { objections: 0, answers: 0, notes: 1, agreed: 6 },
  });
  assert.equal(canSend(loaded), true);
  assert.equal(doubleTap(loaded).effect?.type, "send");
});

test("offline, empty inbox and a failed deck all offer a way forward", () => {
  const offline = markOffline(inboxState());
  assert.equal(pageFor(offline, 1_000).message, "Server unreachable · tap to retry");
  assert.equal(pageFor(offline, 1_000).footer, "Tap: retry");
  assert.deepEqual(press(offline, 1_000).effect, { type: "retry" });

  const empty = adoptInbox(initialState({ demo: true, loading: false }), [], {
    demo: true,
    offline: false,
  });
  assert.match(pageFor(empty, 1_000).message ?? "", /All clear/);
  assert.deepEqual(press(empty, 1_000).effect, { type: "retry" });

  const failed = deckFailed({ ...reviewState(), deck: null }, "Still building. Tap to retry.", 1_000);
  assert.match(pageFor(failed, 1_000).pane ?? "", /Still building/);
  assert.equal(pageFor(failed, 1_000).footer, "Tap: retry · Double-tap: back");
  assert.deepEqual(press(failed, 1_000).effect, { type: "retry-deck" });

  const item = inboxState().inbox.find((entry) => entry.threadId === "login-fix");
  assert.ok(item);
  const pending = startReview(inboxState(), item);
  assert.equal(press(pending, 1_000).effect, undefined, "a 202 still in flight is not retried");
});

test("the countdown is the only confirmation the glasses send path needs", () => {
  const countdown = press({ ...reviewState(), focus: 7 }, 1_000).state;
  assert.equal(countdown.screen, "countdown");
  assert.equal(countdown.countdownStartedAt, 1_000);
  // The legacy preview screen keeps its old gate for the website simulator.
  const legacy = goPreview(reviewState());
  assert.equal(canSend(legacy), false, "an empty preview screen cannot send");
  assert.equal(canSend({ ...legacy, preview: {
    message: "m",
    preview: ["All 7 points agreed", "Tap to send to login-fix"],
    counts: { objections: 0, answers: 0, notes: 0, agreed: 7 },
  }, previewLoading: false }), true);
});

test("swipes are debounced to one move per 250 ms", () => {
  assert.equal(shouldAcceptSwipe(1_000, Number.NEGATIVE_INFINITY), true);
  assert.equal(shouldAcceptSwipe(1_000, 800), false);
  assert.equal(shouldAcceptSwipe(1_049, 800), false);
  assert.equal(shouldAcceptSwipe(1_050, 800), true);
  assert.equal(shouldAcceptSwipe(1_000, 800, 100), true);
});

test("bridge writes run one at a time and a failure does not stall them", async () => {
  const queue = new SerialWrites();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = queue.run(async () => {
    order.push("a-start");
    await gate;
    order.push("a-end");
  });
  const second = queue.run(async () => {
    order.push("b");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["a-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a-start", "a-end", "b"]);

  const failed = queue.run(async () => {
    throw new Error("bridge said no");
  });
  const after = queue.run(async () => {
    order.push("c");
  });
  await assert.rejects(failed, /bridge said no/);
  await after;
  assert.equal(order.at(-1), "c");
});

test("every rebuild re-declares the hold menu", () => {
  const pages = [
    pageFor(inboxState(), 1_000),
    pageFor(reviewState(), 1_000),
    pageFor(press(reviewState("payment-upgrade"), 1_000).state, 1_000),
    pageFor(press({ ...reviewState(), focus: 7 }, 1_000).state, 1_000),
    pageFor(adoptInbox(initialState({ demo: true, loading: false }), [], { demo: true, offline: false }), 1_000),
  ];
  for (const page of pages) {
    const rebuilt = rebuildLayout(page);
    assert.equal(rebuilt.menuObject?.menuItems?.length ?? 0, page.menu.length, page.kind);
    if (page.kind === "countdown" || page.kind === "receipt") {
      assert.equal(page.menu.length, 0, `${page.kind} keeps one action on screen`);
    } else {
      assert.ok((rebuilt.menuObject?.menuItems?.length ?? 0) > 0, page.kind);
    }
  }
});
