import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  OsEventTypeList, StartUpPageCreateResult, Sys_ItemEvent, type EvenAppBridge, type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { createDemoInbox } from "../src/mock";
import { adoptInbox, initialState, type State } from "../src/model";
import { pageFor } from "../src/display";
import { connectEven, exitDialogStep } from "../src/even";

function inboxState(): State {
  return adoptInbox(initialState({ demo: true, loading: false }), createDemoInbox(), {
    demo: true,
    offline: false,
  });
}

function fakeBridge() {
  let listener: ((event: EvenHubEvent) => void) | undefined;
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
  } as unknown as EvenAppBridge;
  return {
    bridge,
    calls,
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
