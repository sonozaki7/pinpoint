import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  OsEventTypeList, StartUpPageCreateResult, Sys_ItemEvent, type EvenAppBridge, type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { createDemoInbox, createLoginDeck } from "../src/mock";
import { adoptInbox, initialState, moveFocus, openDeck, startReview, type State } from "../src/model";
import { pageFor } from "../src/display";
import { connectEven, exitDialogStep } from "../src/even";

function inboxState(): State {
  return adoptInbox(initialState({ demo: true, loading: false }), createDemoInbox(), {
    demo: true,
    offline: false,
  });
}

function fakeBridge(initialWorn: boolean | undefined = undefined) {
  let listener: ((event: EvenHubEvent) => void) | undefined;
  let wearListener: ((status: { isWearing?: boolean }) => void) | undefined;
  const calls: string[] = [];
  const bridge = {
    createStartUpPageContainer: async () => StartUpPageCreateResult.success,
    onEvenHubEvent: (next: (event: EvenHubEvent) => void) => {
      listener = next;
      return () => undefined;
    },
    rebuildPageContainer: async () => {
      calls.push("rebuild");
      return true;
    },
    textContainerUpgrade: async () => {
      calls.push("upgrade");
      return true;
    },
    shutDownPageContainer: async () => {
      calls.push("exit");
      return true;
    },
    audioControl: async () => true,
    onDeviceStatusChanged: (next: (status: { isWearing?: boolean }) => void) => {
      wearListener = next;
      return () => undefined;
    },
    getDeviceInfo: async () => ({ status: { isWearing: initialWorn } }),
  } as unknown as EvenAppBridge;
  return {
    bridge,
    calls,
    wear: (isWearing: boolean) => wearListener?.({ isWearing }),
    emit: (event: EvenHubEvent) => listener?.(event),
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("the exit dialog mapping repaints on the foreground pair and closes on a real exit", () => {
  assert.equal(exitDialogStep(false, OsEventTypeList.FOREGROUND_ENTER_EVENT), "ignore");
  assert.equal(exitDialogStep(false, OsEventTypeList.FOREGROUND_EXIT_EVENT), "ignore");
  assert.equal(exitDialogStep(true, OsEventTypeList.FOREGROUND_ENTER_EVENT), "repaint");
  assert.equal(exitDialogStep(true, OsEventTypeList.FOREGROUND_EXIT_EVENT), "repaint");
  assert.equal(exitDialogStep(true, OsEventTypeList.SYSTEM_EXIT_EVENT), "close");
  assert.equal(exitDialogStep(true, OsEventTypeList.ABNORMAL_EXIT_EVENT), "close");
  assert.equal(exitDialogStep(true, OsEventTypeList.CLICK_EVENT), "ignore");
});

test("cancelling the system exit dialog forces a full repaint of an unchanged page", async () => {
  const host = fakeBridge();
  const state = inboxState();
  const page = pageFor(state, 1_000);
  const inputs: string[] = [];
  const hardware = await connectEven(
    () => page,
    (input) => inputs.push(input.kind),
    () => undefined,
    { bridge: host.bridge },
  );

  await hardware.render(page);
  assert.deepEqual(host.calls, [], "an unchanged render writes nothing");

  await hardware.exit();
  assert.deepEqual(host.calls, ["exit"]);

  host.calls.length = 0;
  host.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT }) });
  await settle();
  assert.deepEqual(host.calls, ["rebuild"], "the dialog appearing repaints behind it");
  assert.deepEqual(inputs, ["surface"], "the surface input is still delivered");

  host.calls.length = 0;
  host.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT }) });
  await settle();
  assert.deepEqual(host.calls, ["rebuild"], "saying No repaints the cleared page");
  assert.deepEqual(inputs, ["surface", "surface"]);

  host.calls.length = 0;
  host.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT }) });
  await settle();
  assert.deepEqual(host.calls, [], "ordinary foreground events stay free once the dialog is closed");
});

test("a real system exit closes the dialog flag without a repaint", async () => {
  const host = fakeBridge();
  const page = pageFor(inboxState(), 1_000);
  const inputs: string[] = [];
  const hardware = await connectEven(
    () => page,
    (input) => inputs.push(input.kind),
    () => undefined,
    { bridge: host.bridge },
  );
  await hardware.exit();
  host.calls.length = 0;
  host.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SYSTEM_EXIT_EVENT }) });
  await settle();
  assert.deepEqual(host.calls, []);
  assert.deepEqual(inputs, ["exit"]);
});

test("wear status from the glasses reaches the app once per change", async () => {
  const host = fakeBridge(false);
  const worn: boolean[] = [];
  const page = pageFor(inboxState(), 1_000);
  await connectEven(
    () => page,
    (input) => { if (input.kind === "wear") worn.push(input.worn); },
    () => undefined,
    { bridge: host.bridge },
  );
  await settle();
  host.wear(false); // same as the seed: ignored
  host.wear(true);
  host.wear(true); // a battery update repeats the flag: ignored
  host.wear(false);
  assert.deepEqual(worn, [false, true, false]);
});

test("moving the cursor in a review changes brightness with upgrades only, never a rebuild", async () => {
  const host = fakeBridge();
  const inbox = inboxState();
  const item = inbox.inbox.find((entry) => entry.threadId === "login-fix")!;
  let state = openDeck(startReview(inbox, item), createLoginDeck());
  const hardware = await connectEven(() => pageFor(state, 1_000), () => undefined, () => undefined, { bridge: host.bridge });
  await hardware.render(pageFor(state, 1_000)); // unchanged: nothing written
  assert.deepEqual(host.calls, []);
  state = moveFocus(state, 1); // the cursor leaves the flagged line for the routine row
  await hardware.render(pageFor(state, 1_000));
  assert.ok(host.calls.length > 0);
  assert.ok(host.calls.every((call) => call === "upgrade"), host.calls.join(","));
});
