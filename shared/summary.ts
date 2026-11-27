import type { Point, ThreadAttention } from "./contract.js";

/**
 * The inbox summary line, shared by the server and the offline mock so both read the same:
 * "6 lines · 1 needs you", "7 points · 2 need you", "7 steps · 1 needs you", "question".
 * Plain TypeScript, no node imports: the browser simulator bundles this too.
 */

type NeedsFields = Pick<Partial<Point>, "flag" | "changed">;

/** Does this point need the reviewer? A changed line counts even with no new flag. */
export function needsYou(point: NeedsFields): boolean {
  return Boolean(point.flag || point.changed);
}

export function needsYouCount<T extends NeedsFields>(points: readonly T[] | undefined): number {
  return (points ?? []).filter(needsYou).length;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max);
  const space = head.lastIndexOf(" ");
  const cut = space >= Math.floor(max * 0.55) ? head.slice(0, space) : head;
  return cut.trimEnd();
}

/**
 * "7 steps · 1 needs you". The G2 firmware has the middle dot (U+00B7), so it can carry this one
 * non-ASCII character; everything else stays plain ASCII. `base` is expected to be one plain line.
 */
export function formatNeedsSummary(base: string, needs: number, max = 30): string {
  if (needs <= 0) return clip(base, max);
  const tail = `${needs} ${needs === 1 ? "needs" : "need"} you`;
  return clip(`${base} · ${tail}`, max);
}

/** The "what is it" half of a summary; `points` is undefined while the deck is still being built. */
export function summaryBase<T extends { kind?: Point["kind"] }>(
  thread: { app?: string | undefined; attention: ThreadAttention },
  points: readonly T[] | undefined,
): string {
  const ready = points !== undefined;
  const count = points?.length ?? 0;
  const drafts = points?.filter((point) => point.kind === "draft").length ?? 0;
  if (thread.app === "gmail") return ready ? `${drafts} line${drafts === 1 ? "" : "s"}` : "draft";
  if (thread.app === "notion") return ready ? `${count} points` : "page review";
  switch (thread.attention) {
    case "plan":
      return ready ? `${count} steps` : "plan";
    case "question":
      return "question";
    case "failed":
      return "run failed";
    case "report":
      return ready ? (drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"}` : `${count} points`) : "report";
  }
}

/** The full inbox summary for one thread. */
export function inboxSummary<T extends NeedsFields & { kind?: Point["kind"] }>(
  thread: { app?: string | undefined; attention: ThreadAttention },
  points: readonly T[] | undefined,
): string {
  return formatNeedsSummary(summaryBase(thread, points), needsYouCount(points));
}
