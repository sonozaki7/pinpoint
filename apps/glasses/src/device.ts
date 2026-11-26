import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

/** Cloud workspace key: the SDK storage is the durable copy, localStorage is the fast cache. */
export const DEVICE_STORAGE_KEY = "pinpoint.device-id";
/** A first run may wait this long for the glasses storage before using the fallback. */
export const STORAGE_BUDGET_MS = 450;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_V4.test(trimmed) ? trimmed : null;
}

/** UUID v4 without assuming a secure context; `crypto.randomUUID` is preferred. */
export function newDeviceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // WebViews without a secure context throw; fall through to random bytes.
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readLocal(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return normalize(window.localStorage.getItem(DEVICE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeLocal(id: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
  } catch {
    // Storage may be disabled; the in-memory promise still keeps one id per run.
  }
}

/** Race a bridge call so a missing or slow host never holds the first screen. */
function withinBudget<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

async function readSdk(): Promise<string | null> {
  const bridge = await waitForEvenAppBridge();
  return normalize(await bridge.getLocalStorage(DEVICE_STORAGE_KEY));
}

async function writeSdk(id: string): Promise<void> {
  try {
    const bridge = await waitForEvenAppBridge();
    await bridge.setLocalStorage(DEVICE_STORAGE_KEY, id);
  } catch {
    // localStorage still carries the id when the host storage is unavailable.
  }
}

let pending: Promise<string> | undefined;

async function resolveDeviceId(): Promise<string> {
  const cached = readLocal();
  if (cached) {
    void writeSdk(cached);
    return cached;
  }
  const stored = await withinBudget(readSdk(), STORAGE_BUDGET_MS);
  const id = stored ?? newDeviceId();
  writeLocal(id);
  if (!stored) void writeSdk(id);
  return id;
}

/** Stable per-install id, sent as X-Pinpoint-Device on every cloud request. */
export function getDeviceId(): Promise<string> {
  pending ??= resolveDeviceId();
  return pending;
}
