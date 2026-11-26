import type { Deck } from "../../../../../shared/contract";
import loginFixJson from "../../../../../demo/fixtures/login-fix.json";
import paymentUpgradeJson from "../../../../../demo/fixtures/payment-upgrade.json";
import type { SimDataset, SimThread } from "./types";

interface FixtureFile {
  thread: {
    threadId: string;
    title: string;
    project: string;
    attention: SimThread["attention"];
    updatedAt: string;
  };
  source: { text: string };
  deck: Deck;
}

const loginFix = loginFixJson as unknown as FixtureFile;
const paymentUpgrade = paymentUpgradeJson as unknown as FixtureFile;

const loginThread: SimThread = {
  ...loginFix.thread,
  app: "t3",
  summary: `plan, ${loginFix.deck.points.length} steps`,
  sourceText: loginFix.source.text,
  deck: loginFix.deck,
  panel: {
    desk: "Pinpoint Desk · acme-shop",
    agent: "T3 Code",
    agentRole: "coding agent · sample thread",
    context:
      "Your agent wants to fix customers being signed out at random. It wrote a seven-step plan and stopped for your review.",
  },
  suggestions: {
    p4: [
      "No. Keep existing sessions and migrate them instead.",
      "This would sign out every customer.",
      "Do it after the sale instead.",
    ],
    p6: ["Release to 5% first, yes.", "Watch the logout rate before going wider."],
    default: ["Agree. Go ahead.", "Make this safer before shipping."],
  },
};

const paymentThread: SimThread = {
  ...paymentUpgrade.thread,
  app: "t3",
  summary: "question",
  sourceText: paymentUpgrade.source.text,
  deck: paymentUpgrade.deck,
  panel: {
    desk: "Pinpoint Desk · acme-shop",
    agent: "T3 Code",
    agentRole: "coding agent · sample thread",
    context:
      "One decision before payments are touched: upgrade the payment library now, or wait until after the weekend sale.",
  },
  suggestions: {
    p1: ["Wait until Monday.", "Upgrade in a test shop first.", "Upgrade now, we can test it."],
    p2: ["Agree. The double-charge fix matters.", "Not worth the risk this week."],
    default: ["Agree with the recommendation.", "Tell me more about the test run."],
  },
};

export const codingAgentsDataset: SimDataset = {
  id: "coding-agents",
  label: "Coding agents",
  tabNote: "T3 Code",
  blurb:
    "A plan with a dangerous step, and a question with a deadline. Both are real Pinpoint fixtures.",
  status: "ready",
  threads: [loginThread, paymentThread],
  demo: {
    threadId: "login-fix",
    pointId: "p4",
    note: "No. Keep existing sessions and migrate them instead.",
    captions: {
      open: "Two agents need you. Scroll to login-fix, then tap.",
      focus: "It opens on step 4: it would sign out every customer.",
      talk: "Tap the ring, then say what to change. We will type it for you.",
      sendRow: "Your note is saved and Send is selected. Tap to send.",
      preview: "Sending in 5. Tap to undo, or let it go.",
      sending: "Sent. The receipt shows for two seconds.",
      reply: "Four seconds later the agent replies. Both panels now show what happened.",
    },
  },
};
