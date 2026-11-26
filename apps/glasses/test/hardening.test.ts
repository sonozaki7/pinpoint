import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createDemoInbox, createLoginDeck, createPaymentDeck } from "../src/mock";
import {
  adoptInbox, canSend, deckFailed, doubleTap, initialState, markOffline, press, shouldAcceptSwipe,
  startReview, type State,
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

  const preview = press({ ...review, focus: 7 }, 1_000).state;
  assert.equal(preview.screen, "preview");
  assert.equal(doubleTap(preview).state.screen, "review");

  const sending = { ...preview, sending: true };
  assert.equal(doubleTap(sending).state, sending, "a send in flight cannot be backed out");
});

test("offline, empty inbox and a failed deck all offer a way forward", () => {
  const offline = markOffline(inboxState());
  assert.equal(pageFor(offline, 1_000).message, "Server unreachable | tap to retry");
  assert.equal(pageFor(offline, 1_000).footer, "tap: retry | 2x: exit");
  assert.deepEqual(press(offline, 1_000).effect, { type: "retry" });

  const empty = adoptInbox(initialState({ demo: true, loading: false }), [], {
    demo: true,
    offline: false,
  });
  assert.match(pageFor(empty, 1_000).message ?? "", /All clear/);
  assert.deepEqual(press(empty, 1_000).effect, { type: "retry" });

  const failed = deckFailed({ ...reviewState(), deck: null }, "Still building. Tap to retry.", 1_000);
  assert.match(pageFor(failed, 1_000).pane ?? "", /Still building/);
  assert.equal(pageFor(failed, 1_000).footer, "tap: retry | 2x: back");
  assert.deepEqual(press(failed, 1_000).effect, { type: "retry-deck" });

  const item = inboxState().inbox.find((entry) => entry.threadId === "login-fix");
  assert.ok(item);
  const pending = startReview(inboxState(), item);
  assert.equal(press(pending, 1_000).effect, undefined, "a 202 still in flight is not retried");
});

test("send requires a loaded preview, not just the preview screen", () => {
  const previewState = press({ ...reviewState(), focus: 7 }, 1_000).state;
  const preview = {
    message: "m",
    preview: ["All 7 points agreed", "Tap to send to login-fix"] as [string, string],
    counts: { objections: 0, answers: 0, notes: 0, agreed: 7 },
  };
  assert.equal(canSend(previewState), false, "an empty preview screen cannot send");
  assert.equal(canSend({ ...previewState, preview, previewLoading: false }), true);
  assert.equal(canSend({ ...previewState, preview, previewLoading: true }), false);
  assert.equal(canSend({ ...previewState, preview, previewLoading: false, sending: true }), false);
  assert.equal(canSend({ ...previewState, preview, previewLoading: false, sent: true }), false);
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
    assert.equal(rebuilt.menuObject?.menuItems?.length, page.menu.length, page.kind);
    assert.ok((rebuilt.menuObject?.menuItems?.length ?? 0) > 0, page.kind);
  }
});
