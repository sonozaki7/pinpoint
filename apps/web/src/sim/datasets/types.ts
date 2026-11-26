import type { AppId, Deck, ThreadAttention } from "../../../../../shared/contract";

/** Panel copy for the two side panels. App names are plain text labels, never logos. */
export interface ThreadPanels {
  /** e.g. "Pinpoint Desk · acme-shop" */
  desk: string;
  /** e.g. "T3 Code" */
  agent: string;
  /** e.g. "coding agent · sample thread" */
  agentRole: string;
  /** One line of context above the numbered plan. */
  context: string;
}

export interface DemoScript {
  threadId: string;
  pointId: string;
  note: string;
  captions: {
    open: string;
    focus: string;
    talk: string;
    sendRow: string;
    preview: string;
    sending: string;
    reply: string;
  };
}

/** A thread plus everything the simulator needs around the real fixture deck. */
export interface SimThread {
  threadId: string;
  app?: AppId;
  title: string;
  project: string;
  attention: ThreadAttention;
  updatedAt: string;
  summary: string;
  sourceText: string;
  deck: Deck;
  panel: ThreadPanels;
  /** Suggested typed notes, keyed by point id; "default" is the fallback. */
  suggestions: Record<string, string[]>;
}

export interface SimDataset {
  id: string;
  /** Tab label, e.g. "Coding agents". */
  label: string;
  /** Small label next to the tab, e.g. "T3 Code". */
  tabNote: string;
  blurb: string;
  status: "ready" | "coming-soon";
  threads: SimThread[];
  demo?: DemoScript;
}
