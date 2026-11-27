import type { InboxItem } from "./contract.js";

/**
 * The one inbox order every Pinpoint surface uses: the offline mock, the
 * browser simulator, Pinpoint Cloud and the desk. Decks wait for your
 * judgment first (question, plan, failed, report), newest first within a
 * kind, and the read-only "Since you looked" row last because it is news,
 * not work.
 *
 * Pure and dependency-free (runs on the server, in the glasses mock and in the
 * browser simulator). Stable: items with the same attention and timestamp keep
 * the order they arrived in.
 */

const ATTENTION_ORDER: Record<InboxItem["attention"], number> = {
  question: 0,
  plan: 1,
  failed: 2,
  report: 3,
};

/** Milliseconds for an ISO timestamp; unparseable values sort as oldest. */
function time(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const news = Number(a.kind === "catch-up") - Number(b.kind === "catch-up");
    if (news !== 0) return news;
    const attention = ATTENTION_ORDER[a.attention] - ATTENTION_ORDER[b.attention];
    // Parsed, not compared as text: sources format timestamps differently (".000Z", "+09:00").
    return attention !== 0 ? attention : time(b.updatedAt) - time(a.updatedAt);
  });
}
