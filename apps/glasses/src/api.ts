import {
  CLOUD_URL,
  DEVICE_HEADER,
  type Deck,
  type EditResult,
  type Health,
  type InboxItem,
  type PreviewResult,
  type ReviewDraft,
  type SendResult,
} from "../../../shared/contract";
import { getDeviceId } from "./device";

export interface PinpointApi {
  readonly mode: "live" | "demo";
  inbox(): Promise<{ items: InboxItem[]; updatedAt: string }>;
  health(): Promise<Health>;
  deck(threadId: string): Promise<Deck | { pending: true }>;
  putReview(draft: ReviewDraft): Promise<ReviewDraft>;
  preview(threadId: string, draft?: ReviewDraft): Promise<PreviewResult>;
  send(threadId: string): Promise<SendResult>;
  /** Apply one spoken note to a 'draft' sentence; the reply carries the new sentence. */
  edit(threadId: string, pointId: string, text: string): Promise<EditResult>;
  voice(
    pcm: Uint8Array,
    context?: { threadId: string; pointId: string },
  ): Promise<{ text: string; verdict?: "object" | "note" }>;
  phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }>;
  resetSample(): Promise<void>;
}

export const LOCAL_SERVER = "http://127.0.0.1:8787";
/** Keep in sync with app.json and package.json. */
export const APP_VERSION = "1.0.0";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
export const DEVICE_BUILD = env.MODE === "evenhub";

/**
 * The one place that chooses the server. A device build (`npm run pack`) points
 * at Pinpoint Cloud unless a developer explicitly overrides it; a simulator or
 * browser build keeps talking to the local server exactly as before.
 */
export const SERVER_URL = (
  env.VITE_PINPOINT_SERVER?.trim() || (DEVICE_BUILD ? CLOUD_URL : LOCAL_SERVER)
).replace(/\/+$/, "");
export const SERVER_IS_CLOUD = SERVER_URL === CLOUD_URL;
/** Kept for callers that still import the old name. */
export const DEFAULT_SERVER = SERVER_URL;

export const TIMEOUTS = {
  inbox: 10_000,
  review: 10_000,
  deck: 65_000,
  send: 15_000,
  voice: 30_000,
  phone: 10_000,
} as const;

export class ApiFailure extends Error {
  readonly kind: "network" | "http";

  constructor(kind: "network" | "http", message: string) {
    super(message);
    this.name = "ApiFailure";
    this.kind = kind;
  }
}

/** A failed connection or timed-out request, as opposed to a server HTTP error. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiFailure && error.kind === "network";
}

export interface HttpApiOptions {
  /** Injectable for tests; production uses the persisted device id. */
  device?: () => Promise<string>;
  /** Force the header on or off; by default every request tries it. */
  deviceHeader?: boolean;
}

export class HttpPinpointApi implements PinpointApi {
  readonly mode = "live" as const;
  private base: string;
  private device: () => Promise<string>;
  private deviceHeader: boolean;

  constructor(base: string, options: HttpApiOptions = {}) {
    this.base = base.replace(/\/+$/, "");
    this.device = options.device ?? getDeviceId;
    this.deviceHeader = options.deviceHeader ?? true;
  }

  private async attempt(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    withDeviceHeader: boolean,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (withDeviceHeader) headers.set(DEVICE_HEADER, await this.device());
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        ...init,
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ApiFailure("network", `${init.method ?? "GET"} ${path}: network error`);
    }
    if (response.status === 202) return response;
    if (!response.ok) {
      throw new ApiFailure("http", `${init.method ?? "GET"} ${path}: HTTP ${response.status}`);
    }
    return response;
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    retry: boolean,
  ): Promise<Response> {
    const cloud = this.base === CLOUD_URL;
    // Local demo servers reject unknown CORS headers. Try the header once, then
    // fall back for this session; the cloud always requires it.
    const attempts = this.deviceHeader && !cloud ? 1 : retry ? 2 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.attempt(path, init, timeoutMs, this.deviceHeader);
      } catch (error) {
        lastError = error;
        if (!isNetworkFailure(error)) throw error;
      }
    }
    if (retry && this.deviceHeader && !cloud) {
      try {
        const response = await this.attempt(path, init, timeoutMs, false);
        this.deviceHeader = false;
        console.info("[pinpoint] server does not accept the device header; continuing without it");
        return response;
      } catch (error) {
        throw error;
      }
    }
    throw lastError;
  }

  private async json<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    retry = false,
  ): Promise<T> {
    const response = await this.request(path, init, timeoutMs, retry);
    return await response.json() as T;
  }

  inbox() {
    return this.json<{ items: InboxItem[]; updatedAt: string }>(
      "/api/inbox",
      { method: "GET" },
      TIMEOUTS.inbox,
      true,
    );
  }

  health() {
    return this.json<Health>("/api/health", { method: "GET" }, TIMEOUTS.inbox, true);
  }

  async deck(threadId: string) {
    const response = await this.request(
      `/api/deck/${encodeURIComponent(threadId)}`,
      { method: "GET" },
      TIMEOUTS.deck,
      true,
    );
    if (response.status === 202) return { pending: true } as const;
    return await response.json() as Deck;
  }

  putReview(draft: ReviewDraft) {
    return this.json<ReviewDraft>(`/api/review/${encodeURIComponent(draft.threadId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }, TIMEOUTS.review);
  }

  preview(threadId: string, draft?: ReviewDraft) {
    return this.json<PreviewResult>(`/api/review/${encodeURIComponent(threadId)}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft ?? {}),
    }, TIMEOUTS.review);
  }

  send(threadId: string) {
    return this.json<SendResult>(`/api/review/${encodeURIComponent(threadId)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, TIMEOUTS.send);
  }

  edit(threadId: string, pointId: string, text: string) {
    return this.json<EditResult>(`/api/edit/${encodeURIComponent(threadId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointId, text }),
    }, TIMEOUTS.review);
  }

  async voice(pcm: Uint8Array) {
    return this.json<{ text: string; verdict?: "object" | "note" }>("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm as unknown as BodyInit,
    }, TIMEOUTS.voice);
  }

  phone(threadId: string, pointId: string) {
    return this.json<{ ok: boolean; link?: string }>(
      `/api/phone/${encodeURIComponent(threadId)}/${encodeURIComponent(pointId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      TIMEOUTS.phone,
    );
  }

  async resetSample(): Promise<void> {
    await this.request("/api/sample/reset", { method: "POST" }, TIMEOUTS.review, false);
  }
}
