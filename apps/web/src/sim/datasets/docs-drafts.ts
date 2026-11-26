import type { SimDataset } from "./types";

/**
 * Dataset slot 2. The lead will supply the Notion page and Gmail draft content;
 * until then the tab stays visible but disabled so the format stays obvious.
 */
export const docsDraftsDataset: SimDataset = {
  id: "docs-drafts",
  label: "Docs & drafts",
  tabNote: "Notion + Gmail",
  blurb: "A Notion page and two Gmail drafts, reviewed the same way.",
  status: "coming-soon",
  threads: [],
};
