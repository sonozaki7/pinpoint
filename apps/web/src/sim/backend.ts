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
} from "../../../../shared/contract";
import type { PinpointApi } from "../../../glasses/src/api";
import { composeReview } from "../../../server/src/core/composer";
import { buildSampleReply } from "../../../server/src/cloud/reply";
import { editDraftSentence } from "../../../glasses/src/mock";
import type { SimDataset, SimThread } from "./datasets/types";

export interface SentHistory {
  message: string;
  counts: PreviewResult["counts"];
  at: string;
}

export interface ThreadHistory {
  sent?: SentHistory;
  reply?: string;
}

export type SimEvent =
  | { type: "opened"; threadId: string; deck: Deck; isReply: boolean; thread: SimThread }
  | { type: "draft"; threadId: string; draft: ReviewDraft }
  | { type: "sent"; threadId: string; message: string; counts: PreviewResult["counts"] }
  | { type: "reply"; threadId: string; text: string; deck: Deck }
  | { type: "inbox" }
  | { type: "reset" };

interface ActiveThread {
  thread: SimThread;
  deck: Deck;
  isReply: boolean;
}

const ATTENTION_ORDER = { question: 0, plan: 1, failed: 2, report: 3 } as const;
const DEVICE_KEY = "pinpoint.sim.device";

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const fresh =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
            const random = (Math.random() * 16) | 0;
            const value = char === "x" ? random : (random & 0x3) | 0x8;
            return value.toString(16);
          });
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "00000000-0000-4000-8000-000000000000";
  }
}

/** Cloud transcription is the only thing that leaves the browser. */
const VOICE_TIMEOUT_MS = 30_000;

function voiceUrl(): string {
  // Local-only test hook. Never let a link send microphone audio to another
  // origin: production always uses Pinpoint Cloud.
  const localPage = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const override = new URLSearchParams(location.search).get("voice");
  if (localPage && override && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(override)) {
    return override.replace(/\/+$/, "");
  }
  return CLOUD_URL;
}

function emptyDraft(deck: Deck): ReviewDraft {
  return {
    threadId: deck.threadId,
    sourceMessageId: deck.sourceMessageId,
    notes: [],
    seen: [],
    updatedAt: new Date().toISOString(),
  };
}

function summaryFor(thread: ActiveThread): string {
  if (thread.isReply) return "agent replied";
  const drafts = thread.deck.points.filter((point) => point.kind === "draft").length;
  switch (thread.deck.attention) {
    case "plan": return `plan, ${thread.deck.points.length} steps`;
    case "question": return "question";
    case "failed": return "run failed";
    case "report": return drafts > 0 ? `${drafts} drafts` : `${thread.deck.points.length} points`;
  }
}

/**
 * The glasses PinpointApi, implemented entirely in this tab over one dataset.
 * Voice is the one call that goes to the real cloud (Whisper); everything else
 * is a deterministic sample workspace, including the delayed agent reply.
 */
export class SimBackend implements PinpointApi {
  readonly mode = "demo" as const;
  readonly dataset: SimDataset;
  private active = new Map<string, ActiveThread>();
  private drafts = new Map<string, ReviewDraft>();
  private history = new Map<string, ThreadHistory>();
  private listeners = new Set<(event: SimEvent) => void>();
  private replyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private replyMs: number;

  constructor(dataset: SimDataset, options: { replyMs?: number } = {}) {
    this.dataset = dataset;
    this.replyMs = options.replyMs ?? 4_000;
    this.seed();
  }

  private seed(): void {
    this.active.clear();
    this.drafts.clear();
    this.history.clear();
    for (const timer of this.replyTimers.values()) clearTimeout(timer);
    this.replyTimers.clear();
    for (const thread of this.dataset.threads) {
      this.active.set(thread.threadId, {
        thread,
        deck: clone(thread.deck),
        isReply: false,
      });
    }
  }

  subscribe(listener: (event: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SimEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  thread(threadId: string): SimThread | undefined {
    return this.dataset.threads.find((thread) => thread.threadId === threadId);
  }

  isReply(threadId: string): boolean {
    return this.active.get(threadId)?.isReply ?? false;
  }

  draft(threadId: string): ReviewDraft | undefined {
    return this.drafts.get(threadId);
  }

  historyFor(threadId: string): ThreadHistory {
    return this.history.get(threadId) ?? {};
  }

  suggestionsFor(threadId: string, pointId: string | undefined): string[] {
    const thread = this.thread(threadId);
    if (!thread) return [];
    return thread.suggestions[pointId ?? "default"] ?? thread.suggestions.default ?? [];
  }

  async inbox(): Promise<{ items: InboxItem[]; updatedAt: string }> {
    const items: InboxItem[] = [...this.active.values()].map(({ thread, deck, isReply }) => ({
      threadId: thread.threadId,
      app: thread.app ?? "t3",
      title: thread.title,
      project: thread.project,
      attention: isReply ? "report" : thread.attention,
      summary: summaryFor({ thread, deck, isReply }),
      updatedAt: isReply ? new Date().toISOString() : thread.updatedAt,
      deckReady: true,
      pointCount: deck.points.length,
      draftNotes: this.drafts.get(thread.threadId)?.notes.length ?? 0,
    }));
    items.sort((a, b) => {
      const kind = ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention];
      return kind !== 0 ? kind : b.updatedAt.localeCompare(a.updatedAt);
    });
    return { items, updatedAt: new Date().toISOString() };
  }

  async health(): Promise<Health> {
    return {
      ok: true,
      mode: "demo",
      t3: "off",
      telegram: "off",
      splitter: "fixture",
    };
  }

  async deck(threadId: string): Promise<Deck> {
    const entry = this.active.get(threadId);
    if (!entry) throw new Error(`Unknown thread: ${threadId}`);
    this.emit({
      type: "opened",
      threadId,
      deck: clone(entry.deck),
      isReply: entry.isReply,
      thread: entry.thread,
    });
    return clone(entry.deck);
  }

  async putReview(draft: ReviewDraft): Promise<ReviewDraft> {
    const saved = clone(draft);
    this.drafts.set(draft.threadId, saved);
    this.emit({ type: "draft", threadId: draft.threadId, draft: saved });
    return saved;
  }

  async preview(threadId: string, draft?: ReviewDraft): Promise<PreviewResult> {
    const entry = this.active.get(threadId);
    if (!entry) throw new Error(`Unknown thread: ${threadId}`);
    const saved = draft ?? this.drafts.get(threadId) ?? emptyDraft(entry.deck);
    return composeReview(entry.deck, saved);
  }

  async edit(threadId: string, pointId: string, text: string): Promise<EditResult> {
    const entry = this.active.get(threadId);
    const point = entry?.deck.points.find((candidate) => candidate.id === pointId);
    if (!point || point.kind !== "draft") {
      return {
        ok: false,
        pointId,
        before: point?.quote ?? "",
        error: "Couldn't change this line",
      };
    }
    const result = editDraftSentence(point.quote, text);
    return {
      ok: result.ok,
      pointId,
      before: point.quote,
      ...(result.after !== undefined ? { after: result.after } : {}),
      ...(result.method ? { method: result.method } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async send(threadId: string): Promise<SendResult> {
    const entry = this.active.get(threadId);
    if (!entry) return { ok: false, delivered: "sample", error: "Unknown thread" };
    const draft = this.drafts.get(threadId) ?? emptyDraft(entry.deck);
    const preview = composeReview(entry.deck, draft);

    this.history.set(threadId, {
      ...this.history.get(threadId),
      sent: { message: preview.message, counts: preview.counts, at: new Date().toISOString() },
    });
    this.drafts.delete(threadId);
    this.active.delete(threadId);
    this.emit({ type: "sent", threadId, message: preview.message, counts: preview.counts });

    if (!entry.isReply) this.scheduleReply(entry, draft);
    const app = entry.thread.app ?? "t3";
    const receiptText = app === "gmail"
      ? "Draft review sent"
      : app === "notion"
        ? "Review posted to the page"
        : "Review sent to the agent";
    return {
      ok: true,
      delivered: "sample",
      receipt: { lines: [{ app, text: receiptText, ok: true }] },
    };
  }

  private scheduleReply(entry: ActiveThread, draft: ReviewDraft): void {
    const existing = this.replyTimers.get(entry.thread.threadId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.replyTimers.delete(entry.thread.threadId);
      const reply = buildSampleReply({
        thread: {
          threadId: entry.thread.threadId,
          title: entry.thread.title,
          project: entry.thread.project,
          attention: entry.thread.attention,
          updatedAt: entry.thread.updatedAt,
        },
        deck: entry.deck,
        draft,
      });
      this.active.set(entry.thread.threadId, {
        thread: entry.thread,
        deck: reply.deck,
        isReply: true,
      });
      this.history.set(entry.thread.threadId, {
        ...this.history.get(entry.thread.threadId),
        reply: reply.text,
      });
      this.emit({ type: "reply", threadId: entry.thread.threadId, text: reply.text, deck: reply.deck });
      this.emit({ type: "inbox" });
    }, this.replyMs);
    this.replyTimers.set(entry.thread.threadId, timer);
  }

  /**
   * The real cloud path: 16 kHz mono s16le PCM to Pinpoint Cloud's Whisper
   * service. There is no fake transcript: on failure the UI offers chips and
   * a text box, so nobody mistakes a canned line for their own voice.
   */
  async voice(
    pcm: Uint8Array,
    _context?: { threadId: string; pointId: string },
  ): Promise<{ text: string; verdict?: "object" | "note" }> {
    if (pcm.length === 0) throw new Error("No audio captured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
    try {
      const response = await fetch(`${voiceUrl()}/api/voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          [DEVICE_HEADER]: deviceId(),
        },
        body: pcm as unknown as BodyInit,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Voice HTTP ${response.status}`);
      const body = (await response.json()) as { text?: unknown; verdict?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new Error("No transcript");
      const verdict = body.verdict === "object" || body.verdict === "note" ? body.verdict : undefined;
      return { text, verdict };
    } finally {
      clearTimeout(timer);
    }
  }

  async phone(_threadId: string, _pointId: string): Promise<{ ok: boolean; link?: string }> {
    return { ok: false };
  }

  async resetSample(): Promise<void> {
    this.seed();
    this.emit({ type: "reset" });
  }

  dispose(): void {
    for (const timer of this.replyTimers.values()) clearTimeout(timer);
    this.replyTimers.clear();
    this.listeners.clear();
  }
}
