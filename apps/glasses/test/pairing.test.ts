import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CLOUD_URL, DEVICE_HEADER, TOKEN_HEADER } from "../../../shared/contract";
import {
  formatPairCode,
  HttpPinpointApi,
  normalizePairCode,
  pairingStatusText,
} from "../src/api";
import {
  getDeskToken,
  normalizeDeskToken,
  resetDeskTokenCacheForTests,
  setDeskToken,
} from "../src/device";
import { pageFor } from "../src/display";
import { adoptInbox, applyHealth, initialState } from "../src/model";
import { createDemoInbox } from "../src/mock";

const TOKEN = "A".repeat(43);
const DEVICE = "11111111-1111-4111-8111-111111111111";

function inboxState() {
  return adoptInbox(initialState({ demo: true, loading: false }), createDemoInbox(), {
    demo: true,
    offline: false,
  });
}

test("pairing codes accept a dash, spaces and lower case", () => {
  assert.equal(normalizePairCode("K7Q4-2MXP"), "K7Q42MXP");
  assert.equal(normalizePairCode("k7q4 2mxp"), "K7Q42MXP");
  assert.equal(normalizePairCode("  K7Q42MXP  "), "K7Q42MXP");
  assert.equal(normalizePairCode("K7Q4-2MX"), null);
  assert.equal(normalizePairCode("IIII-1111"), null);
  assert.equal(normalizePairCode(""), null);
  assert.equal(formatPairCode("k7q42mxp"), "K7Q4-2MXP");
  assert.equal(formatPairCode("nope"), null);
});

test("the phone card says who it is connected to and whether the desk is online", () => {
  assert.equal(pairingStatusText({ paired: false }), "Not connected");
  assert.equal(
    pairingStatusText({ paired: true, deskName: "so-MacBook", online: true }),
    "Connected to so-MacBook · online",
  );
  assert.equal(
    pairingStatusText({ paired: true, deskName: "so-MacBook", online: false }),
    "Connected to so-MacBook · offline",
  );
  assert.equal(pairingStatusText({ paired: true }), "Connected to your computer · offline");
});

test("device tokens are validated before storage", async () => {
  assert.equal(normalizeDeskToken(TOKEN), TOKEN);
  assert.equal(normalizeDeskToken("short"), null);
  assert.equal(normalizeDeskToken(null), null);
  resetDeskTokenCacheForTests();
  await setDeskToken(TOKEN);
  assert.equal(await getDeskToken(), TOKEN);
  await setDeskToken("not a token");
  assert.equal(await getDeskToken(), null);
  await setDeskToken(null);
  assert.equal(await getDeskToken(), null);
  resetDeskTokenCacheForTests();
});

test("every request carries X-Pinpoint-Token once the device is paired", async () => {
  const realFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ items: [], updatedAt: "2026-11-27T00:00:00.000Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi(CLOUD_URL, {
      device: async () => DEVICE,
      token: async () => TOKEN,
    });
    await api.inbox();
    const headers = new Headers(calls[0]?.headers);
    assert.equal(headers.get(DEVICE_HEADER), DEVICE);
    assert.equal(headers.get(TOKEN_HEADER), TOKEN);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a wrong pairing code returns the cloud's reason instead of throwing", async () => {
  const realFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(
      JSON.stringify({ ok: false, error: "That code is wrong or has expired." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi(CLOUD_URL, {
      device: async () => DEVICE,
      token: async () => null,
    });
    const result = await api.pair("K7Q4-2MXP");
    assert.deepEqual(result, { ok: false, error: "That code is wrong or has expired." });
    const headers = new Headers(calls[0]?.headers);
    assert.equal(headers.get(DEVICE_HEADER), DEVICE);
    assert.equal(headers.get(TOKEN_HEADER), null);
    assert.equal(calls[0]?.method, "POST");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("disconnect sends DELETE with the device token", async () => {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new HttpPinpointApi(CLOUD_URL, {
      device: async () => DEVICE,
      token: async () => TOKEN,
    });
    assert.deepEqual(await api.unpair(), { ok: true });
    assert.equal(calls[0]?.url, `${CLOUD_URL}/api/pair`);
    assert.equal(calls[0]?.init.method, "DELETE");
    assert.equal(new Headers(calls[0]?.init.headers).get(TOKEN_HEADER), TOKEN);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the glasses header names the paired desk instead of Sample", () => {
  const state = applyHealth(
    { ...inboxState(), demo: false, cloud: true },
    {
      ok: true,
      mode: "cloud",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
      workspace: "desk",
      pairing: true,
      desk: { name: "so-MacBook", online: true },
    },
  );
  assert.equal(state.desk?.name, "so-MacBook");
  assert.match(pageFor(state, 1_000).title, /^so-MacBook · \d+ need/);
  assert.equal(pageFor(state, 1_000).title.includes("Sample"), false);

  const offline = applyHealth(
    { ...state, offline: true },
    {
      ok: true,
      mode: "cloud",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
      workspace: "desk",
      pairing: true,
      desk: { name: "so-MacBook", online: false },
    },
  );
  assert.equal(pageFor(offline, 1_000).subtitle, "offline");
});

test("unpaired cloud devices keep the Sample header", () => {
  const state = applyHealth(
    { ...inboxState(), demo: false, cloud: true },
    {
      ok: true,
      mode: "cloud",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
      workspace: "sample",
      pairing: true,
    },
  );
  assert.equal(state.desk, null);
  assert.match(pageFor(state, 1_000).title, /^Sample · /);
});
