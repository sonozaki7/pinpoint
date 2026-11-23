import type {
  Deck, InboxItem, PreviewResult, ReviewDraft, SendResult,
} from "../../../shared/contract";

export interface PinpointApi {
  readonly mode: "live" | "demo";
  inbox(): Promise<{ items: InboxItem[]; updatedAt: string }>;
  deck(threadId: string): Promise<Deck | { pending: true }>;
  putReview(draft: ReviewDraft): Promise<ReviewDraft>;
  preview(threadId: string, draft?: ReviewDraft): Promise<PreviewResult>;
  send(threadId: string): Promise<SendResult>;
  voice(pcm: Uint8Array): Promise<{ text: string; verdict?: "object" | "note" }>;
  phone(threadId: string, pointId: string): Promise<{ ok: boolean; link?: string }>;
}

export const DEFAULT_SERVER = "http://127.0.0.1:8787";

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 202) return response;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: HTTP ${response.status}`);
  return response;
}

export class HttpPinpointApi implements PinpointApi {
  readonly mode = "live" as const;
  private base: string;

  constructor(base: string) {
    this.base = base.replace(/\/+$/, "");
  }

  private async json<T>(path: string, init: RequestInit = {}, timeoutMs = 6_000): Promise<T> {
    const response = await request(this.base + path, init, timeoutMs);
    return await response.json() as T;
  }

  inbox() {
    return this.json<{ items: InboxItem[]; updatedAt: string }>("/api/inbox", { method: "GET" }, 4_000);
  }

  async deck(threadId: string) {
    const response = await request(
      `${this.base}/api/deck/${encodeURIComponent(threadId)}`,
      { method: "GET" },
      20_000,
    );
    if (response.status === 202) return { pending: true } as const;
    return await response.json() as Deck;
  }

  putReview(draft: ReviewDraft) {
    return this.json<ReviewDraft>(`/api/review/${encodeURIComponent(draft.threadId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
  }

  preview(threadId: string, draft?: ReviewDraft) {
    return this.json<PreviewResult>(`/api/review/${encodeURIComponent(threadId)}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft ?? {}),
    }, 10_000);
  }

  send(threadId: string) {
    return this.json<SendResult>(`/api/review/${encodeURIComponent(threadId)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, 15_000);
  }

  async voice(pcm: Uint8Array) {
    return this.json<{ text: string; verdict?: "object" | "note" }>("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm as unknown as BodyInit,
    }, 30_000);
  }

  phone(threadId: string, pointId: string) {
    return this.json<{ ok: boolean; link?: string }>(
      `/api/phone/${encodeURIComponent(threadId)}/${encodeURIComponent(pointId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      10_000,
    );
  }
}
