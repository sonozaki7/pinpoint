import { codingAgentsDataset } from "./coding-agents";
import { docsDraftsDataset } from "./docs-drafts";
import type { SimDataset } from "./types";

export { codingAgentsDataset, docsDraftsDataset };
export type { DemoScript, SimDataset, SimThread, ThreadPanels } from "./types";

export const DATASETS: SimDataset[] = [codingAgentsDataset, docsDraftsDataset];

export function datasetById(id: string): SimDataset {
  return DATASETS.find((dataset) => dataset.id === id) ?? codingAgentsDataset;
}
