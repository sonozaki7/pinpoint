import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEVICE_HEADER } from "../../../shared/contract";
import {
  ApiFailure, HttpPinpointApi, isNetworkFailure, LOCAL_SERVER, SERVER_IS_CLOUD, SERVER_URL, TIMEOUTS,
} from "../src/api";
import { newDeviceId } from "../src/device";
import { pageFor } from "../src/display";
import {
  adoptInbox, applyHealth, finishSend, initialState, openDeck, setFlash, startReview, type State,
} from "../src/model";
import { createDemoInbox, createLoginDeck } from "../src/mock";

function inboxState(): State {
  return adoptInbox(initialState({ demo: true, loading: false }), createDemoInbox(), {
    demo: true,
    offline: false,
  });
}

function sampleState(): State {
  return {
    ...inboxState(),
    demo: false,
    cloud: true,
    workspace: "sample",
    serverVersion: "1.1.0",
  };
}

test("the sample workspace names itself, offers Reset sample, and explains the empty inbox", () => {
  const state = sampleState();
  assert.equal(pageFor(state, 1_000).title, "Sample · 3 need you");
  assert.deepEqual(pageFor(state, 1_000).menu.map((item) => item.label), [
    "New task",
    "Sample: Everyday", "Sample: Developer", "Sample: Mixed (now)",
    "Refresh", "Reset sample",
  ]);

  const empty = adoptInbox(state, [], { demo: false, offline: false });
  assert.equal(pageFor(empty, 1_000).title, "Sample");
  assert.equal(pageFor(empty, 1_000).message, "All clear. Hold for menu: Reset sample");
  assert.equal(pageFor(empty, 1_000).footer, "Hold: menu");

  const item = state.inbox.find((entry) => entry.threadId === "login-fix");
  assert.ok(item);
  const review = openDeck(startReview(state, item), createLoginDeck());
  assert.deepEqual(
    pageFor(review, 1_000).menu.map((entry) => entry.label),
    ["Ask", "Send review", "Read on phone", "Clear notes", "Refresh", "Reset sample"],
  );
});

test("the ordinary demo keeps its own header and menu", () => {
  const state = inboxState();
  assert.equal(pageFor(state, 1_000).title, "Pinpoint · 3 need you");
  assert.deepEqual(pageFor(state, 1_000).menu.map((item) => item.label), [
    "New task", "Refresh",
  ]);
});

test("a short inbox notice replaces the footer until it expires", () => {
  const state = setFlash(sampleState(), "Agent replied", 1_000, 3_000);
  assert.equal(pageFor(state, 2_000).footer, "Agent replied");
  assert.match(pageFor(state, 5_000).footer, /^Tap: open/);
});

test("health names the workspace and server version; an offline message overrides the default", () => {
  const state = applyHealth(inboxState(), {
    ok: true,
    mode: "cloud",
    t3: "off",
    telegram: "off",
    splitter: "sample",
    workspace: "sample",
    pairing: false,
    version: "1.4.2",
  });
  assert.equal(state.workspace, "sample");
  assert.equal(state.serverVersion, "1.4.2");
  const offline = {
    ...state,
    offline: true,
    offlineMessage: "Can't reach Pinpoint Cloud.\nCheck your phone's internet.\nTap to retry.",
  };
  assert.match(pageFor(offline, 1_000).message ?? "", /Check your phone's internet/);
});

test("a sample send does not hide a thread that the sample agent may reuse", () => {
  const state = sampleState();
  const item = state.inbox.find((entry) => entry.threadId === "login-fix");
  assert.ok(item);
  const review = openDeck(startReview(state, item), createLoginDeck());
  const sent = finishSend({ ...review, focus: 7 });
  assert.equal(sent.resolved.includes("login-fix"), false);
  const adopted = adoptInbox(sent, createDemoInbox(), { demo: false, offline: false });
  assert.ok(adopted.inbox.some((entry) => entry.threadId === "login-fix"));
});

test("the device id is a random UUID v4", () => {
  const ids = new Set(Array.from({ length: 20 }, () => newDeviceId()));
  assert.equal(ids.size, 20);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
});

test("a dev build still defaults to the local server", () => {
  assert.equal(SERVER_URL, LOCAL_SERVER);
  assert.equal(SERVER_IS_CLOUD, false);
});

test("request timeouts match the device contract", () => {
  assert.equal(TIMEOUTS.inbox, 10_000);
  assert.equal(TIMEOUTS.review, 10_000);
  assert.equal(TIMEOUTS.deck, 65_000);
  assert.equal(TIMEOUTS.voice, 30_000);
});

test("cloud requests carry X-Pinpoint-Device and an inbox GET retries once", async () => {
  const realFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  let attempts = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    attempts++;
    if (attempts === 1) throw new TypeError("network down");
    return new Response(JSON.stringify({ items: [], updatedAt: "2026-11-27T00:00:00.000Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi("https://pinpoint-api.qolso.com", {
      device: async () => "11111111-1111-4111-8111-111111111111",
    });
    const inbox = await api.inbox();
    assert.deepEqual(inbox.items, []);
    assert.equal(calls.length, 2, "one retry after the network error");
    for (const init of calls) {
      const headers = new Headers(init.headers);
      assert.equal(headers.get(DEVICE_HEADER), "11111111-1111-4111-8111-111111111111");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a local server without header CORS still works after one probe", async () => {
  const realFetch = globalThis.fetch;
  const headers: Array<string | null> = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    headers.push(new Headers(init?.headers).get(DEVICE_HEADER));
    if (headers.length === 1) throw new TypeError("CORS preflight refused");
    return new Response(JSON.stringify({ items: [], updatedAt: "2026-11-27T00:00:00.000Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi("http://127.0.0.1:8788", {
      device: async () => "11111111-1111-4111-8111-111111111111",
    });
    const inbox = await api.inbox();
    assert.deepEqual(inbox.items, []);
    assert.deepEqual(headers, ["11111111-1111-4111-8111-111111111111", null]);
    // The session remembers that this server does not accept the header.
    await api.inbox();
    assert.equal(headers.at(-1), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a send is not retried on a network error", async () => {
  const realFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    throw new TypeError("network down");
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi("https://pinpoint-api.qolso.com", {
      device: async () => "11111111-1111-4111-8111-111111111111",
    });
    await assert.rejects(api.send("login-fix"), (error) => isNetworkFailure(error));
    assert.equal(attempts, 1);
    assert.equal(isNetworkFailure(new ApiFailure("http", "HTTP 500")), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
