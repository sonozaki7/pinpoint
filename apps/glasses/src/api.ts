import {
  CLOUD_URL,
  DEVICE_HEADER,
  SAMPLE_HEADER,
  TOKEN_HEADER,
  type AgentStatus,
  type AskResult,
  type Deck,
  type EditResult,
  type Health,
  type InboxItem,
  type PairResult,
  type PreviewResult,
  type ReviewDraft,
  type SendResult,
  type TaskResult,
} from "../../../shared/contract";
import { getDeskToken, getDeviceId } from "./device";
import { DEFAULT_PERSONA, type SamplePersona } from "./model";

export interface PinpointApi {
  readonly mode: "live" | "demo";
  inbox(): Promise<{ items: InboxItem[]; updatedAt: string; status?: AgentStatus }>;
  health(): Promise<Health>;
  deck(threadId: string): Promise<Deck | { pending: true }>;
  putReview(draft: ReviewDraft): Promise<ReviewDraft>;
  preview(threadId: string, draft?: ReviewDraft): Promise<PreviewResult>;
  send(threadId: string): Promise<SendResult>;
  /** Apply one spoken note to a 'draft' sentence; the reply carries the new sentence. */
  edit(threadId: string, pointId: string, text: string): Promise<EditResult>;
  /** Ask about the output; the answer cites an exact source sentence and its point. */
  ask?(threadId: string, question: string): Promise<AskResult>;
  /** Hand a new job to an agent ("Find a dentist open Saturday..."). */
  task?(text: string): Promise<TaskResult>;
  /** Choose the cloud sample story (sent as X-Pinpoint-Sample). Mock and cloud only. */
  setSample?(persona: SamplePersona): void;
  /**
   * Turn speech into text. `purpose` only matters to the offline demo, which has no
   * microphone and must say something sensible; a real server just transcribes.
   */
  voice(
    pcm: Uint8Array,
    context?: { threadId: string; pointId?: string },
    purpose?: "note" | "ask" | "task",
  ): Promise<{ text: string; verdict?: "object" | "note" }>;
  phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }>;
  resetSample(): Promise<void>;
  /** Cloud only: pair with the desk behind a one-time code. Optional for mock/local builds. */
  pair?(code: string): Promise<PairResult>;
  /** Cloud only: forget this device's desk token. */
  unpair?(): Promise<{ ok: boolean; error?: string }>;
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
  ask: 20_000,
  task: 20_000,
  phone: 10_000,
  pair: 15_000,
} as const;

/**
 * Same unambiguous alphabet as the cloud: no 0/O or 1/I/L. The user may type
 * "K7Q4-2MXP", "k7q4 2mxp" or "K7Q42MXP".
 */
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normalizePairCode(raw: string): string | null {
  const compact = raw.replace(/[\s-]+/g, "").toUpperCase();
  if (compact.length !== 8) return null;
  for (const char of compact) {
    if (!PAIR_ALPHABET.includes(char)) return null;
  }
  return compact;
}

export function formatPairCode(raw: string): string | null {
  const compact = normalizePairCode(raw);
  return compact ? `${compact.slice(0, 4)}-${compact.slice(4)}` : null;
}

/** One line for the phone page: "Connected to Mac · online" / "Not connected". */
export function pairingStatusText(input: {
  paired: boolean;
  deskName?: string | null;
  online?: boolean;
}): string {
  if (!input.paired) return "Not connected";
  const name = input.deskName?.trim() || "your computer";
  return `Connected to ${name} · ${input.online ? "online" : "offline"}`;
}

export class ApiFailure extends Error {
  readonly kind: "network" | "http";
  /** HTTP status when known; 503 means a paired desk is offline. */
  readonly status?: number;

  constructor(kind: "network" | "http", message: string, status?: number) {
    super(message);
    this.name = "ApiFailure";
    this.kind = kind;
    this.status = status;
  }
}

/** A failed connection or timed-out request, as opposed to a server HTTP error. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiFailure && error.kind === "network";
}

export interface HttpApiOptions {
  /** Injectable for tests; production uses the persisted device id. */
  device?: () => Promise<string>;
  /** Injectable for tests; production reads the stored desk token. */
  token?: () => Promise<string | null>;
  /** Force the header on or off; by default every request tries it. */
  deviceHeader?: boolean;
  /** The saved sample story; 'mixed' is the server default and is never sent. */
  sample?: SamplePersona;
}

export class HttpPinpointApi implements PinpointApi {
  readonly mode = "live" as const;
  private base: string;
  private device: () => Promise<string>;
  private token: () => Promise<string | null>;
  private deviceHeader: boolean;
  private sample: SamplePersona;

  constructor(base: string, options: HttpApiOptions = {}) {
    this.sample = options.sample ?? DEFAULT_PERSONA;
    this.base = base.replace(/\/+$/, "");
    this.device = options.device ?? getDeviceId;
    // The desk token is a cloud credential; local simulator builds never read it.
    this.token = options.token ?? (this.base === CLOUD_URL ? getDeskToken : async () => null);
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
    const token = await this.token();
    if (token) headers.set(TOKEN_HEADER, token);
    // Only a non-default story adds a header, so the default flow adds nothing new to CORS.
    if (this.sample !== DEFAULT_PERSONA && !token) headers.set(SAMPLE_HEADER, this.sample);
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
      throw new ApiFailure(
        "http",
        `${init.method ?? "GET"} ${path}: HTTP ${response.status}`,
        response.status,
      );
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

  ask(threadId: string, question: string) {
    return this.json<AskResult>(`/api/ask/${encodeURIComponent(threadId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }, TIMEOUTS.ask);
  }

  task(text: string) {
    return this.json<TaskResult>("/api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }, TIMEOUTS.task);
  }

  setSample(persona: SamplePersona) {
    this.sample = persona;
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

  /**
   * Pair with a desk. A 400/429 answer still carries a PairResult with the
   * reason, so return it instead of throwing; only transport failures throw.
   */
  async pair(code: string): Promise<PairResult> {
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    headers.set(DEVICE_HEADER, await this.device());
    const token = await this.token();
    if (token) headers.set(TOKEN_HEADER, token);
    let response: Response;
    try {
      response = await fetch(`${this.base}/api/pair`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code }),
        cache: "no-store",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(TIMEOUTS.pair),
      });
    } catch {
      throw new ApiFailure("network", "POST /api/pair: network error");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (body && typeof body === "object" && typeof (body as PairResult).ok === "boolean") {
      return body as PairResult;
    }
    if (!response.ok) {
      throw new ApiFailure("http", `POST /api/pair: HTTP ${response.status}`, response.status);
    }
    return { ok: false, error: "Pinpoint Cloud did not answer with a pairing result." };
  }

  async unpair(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.request("/api/pair", { method: "DELETE" }, TIMEOUTS.review, false);
      return { ok: true };
    } catch (error) {
      // Already-unpaired answers are success for the caller.
      if (
        error instanceof ApiFailure &&
        error.kind === "http" &&
        (error.status === 401 || error.status === 404)
      ) {
        return { ok: true };
      }
      throw error;
    }
  }
}
