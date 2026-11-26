import review from "./review.json";

export const PLAN = [
  "Reproduce the bug with two open tabs",
  "Add a test that fails on the bug",
  "One tab renews login, other tabs wait",
  "Sign out every customer once",
  "Keep the 30-day sign-in as today",
  "Release to 5% first, watch errors",
  "Release to all if errors stay flat",
];

export const PLAN_TITLE = "Login fix: 7-step plan";
export const BAD_STEP = 4;
export const BAD_STEP_TEXT = "Sign out every customer once";
export const USER_NOTE = "Don't sign everyone out. Just fix the broken logins.";
export const USER_QUOTE = ["Don't sign everyone out.", "Just fix the broken logins."];

export const REVIEW_TEXT = review.message;
export const AGENT_REPLY =
  "Got it. I won't sign anyone out. I'll fix the broken logins quietly instead.";

export const PROOF_LINE =
  "Real run with T3 Code: reviewed in 20 s, agent replied in 7 s.";

// Burned-in captions are shorter than the spoken lines: one idea, seven words
// or fewer. The narration itself is in narration.json (and v3-scenes.md).
export const CAPTION_TEXT: Record<string, string> = {
  s1: "Your AI agent needs your OK.",
  s2: "You're not at your desk.",
  s3a: "Today: two buttons. Yes or no.",
  s3b: "Step 4: sign out everyone.",
  s3c: "Yes ships the mistake.",
  s4: "Point at the line. Say the fix.",
  s5c: "Skipped steps count as agreed.",
  s6: "Exact, quoted feedback.",
  s7: "Full text in Telegram.",
};

export const AGENT_PLAN_TEXT = `## Plan: stop customers getting logged out at random

What's happening: when a customer's login expires while two tabs are open, both tabs try to renew it at the same moment. One wins, the other fails, and the customer is logged out. Support has 38 tickets about this in the last two weeks, mostly from people who keep the shop open in several tabs while they compare products.

Here is how I'd fix it:

1. Reproduce the bug with two open tabs, so we can watch it happen. I'll script it in the browser test suite so it runs the same way every time.
2. Add a test that fails while the bug exists. That way we know the fix works, and we'll notice if the bug ever comes back.
3. Let one tab renew the login while the other tabs wait for it. The waiting tabs reuse the new login as soon as it arrives, so nobody sees an error.
4. Sign out every customer once, to clear out the broken logins. Some logins are already in a bad state, and this is the quickest way to reset them.
5. Keep the 30-day sign-in, same as today. Customers shouldn't notice any change apart from the bug going away.
6. Release to 5% of customers first and watch the error rate. If logouts drop as expected, we continue; if anything looks off, we roll back in one click.
7. Release to everyone if errors stay flat for a day.

What I need from you: an OK on the plan, or changes to any step. I'll start with step 1 as soon as you approve, and I'll post an update in this chat when the test is in place.`;

export type ExtraCue = {id: string; start: number; end: number; text: string; style?: "label" | "quote"};

// Label cues are not narration; they are big on-screen labels for the
// three rapid examples in the "More" scene.
export const EXTRA_CUES: ExtraCue[] = [
  {id: "s6b", start: 68.6, end: 73.4, text: "The agent keeps working.", style: "label"},
  {id: "more-1", start: 86.2, end: 88.6, text: "Questions: one tap.", style: "label"},
  {id: "more-2", start: 88.9, end: 91.7, text: "Email drafts: fix one line.", style: "label"},
  {id: "more-3", start: 91.95, end: 95.0, text: "All your agents, one inbox.", style: "label"},
];
