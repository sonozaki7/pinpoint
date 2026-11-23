import thread from "./fixtures/t3-live-thread.json";

// The only place the real conversation is read. Every visible string is a
// slice of the export; long reply paragraphs are cut with … but never reworded.
export const T3_THREAD = thread;
export const T3_REVIEW_LINES = thread.review.text.split("\n").slice(1);
export const T3_PLAN_TITLE = 'Plan: stop the "logged out mid-edit" 401s';
export const T3_REVIEW_HEAD = "Review from G2 (Pinpoint) — 7 points";
export const T3_AGREED = "Agreed: 1, 2, 3, 5, 7. Continue.";

const replyText = thread.reply.text;

const excerptBetween = (start: string, end: string): string => {
  const from = replyText.indexOf(start);
  const to = replyText.indexOf(end, from);
  if (from < 0 || to < 0 || to <= from) throw new Error(`T3 reply excerpt markers not found: ${start} / ${end}`);
  return `${replyText.slice(from, to).trimEnd()} …`;
};

export const T3_BULLET_4 = excerptBetween("- **4 — dropped.**", "Mobile app and CLI users").replace(/^- /, "");
export const T3_BULLET_6 = excerptBetween("- **6 — changed from a mutex", "A queue fixes that").replace(/^- /, "");
export const T3_STEP_6 = excerptBetween("**Step 6 — per-family request queue", " In `packages/api/src/auth/refresh.ts`");
export const T3_RETRY = excerptBetween("The retry path no longer", "**Step 7");
export const T3_REPLY_HEAD = "Acknowledged";
export const T3_PROOF = "Reviewed in 20 s · 2 notes · agent replied in 7 s";
