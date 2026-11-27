import layout from "./layout.generated.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type FinalSceneId = "hook" | "problem" | "intro" | "walk" | "everyday" | "proof" | "close";
export type FinalScene = {id: FinalSceneId; start: number; end: number; label: string};

type LayoutScene = {start: number; end: number};
const L = layout.scenes as unknown as Record<string, LayoutScene>;

/** Seconds. Hook/problem/intro are fixed; footage scenes follow the recordings (layout.generated.json). */
export const SCENES: FinalScene[] = [
  {id: "hook", start: 0, end: 15.4, label: "Hook"},
  {id: "problem", start: 15.4, end: 31.0, label: "Problem"},
  {id: "intro", start: 31.0, end: L.walk.start, label: "Pinpoint"},
  {id: "walk", start: L.walk.start, end: L.walk.end, label: "Morning walk"},
  {id: "everyday", start: L.everyday.start, end: L.everyday.end, label: "Everyday"},
  {id: "proof", start: L.proof.start, end: L.proof.end, label: "Proof"},
  {id: "close", start: L.close.start, end: L.close.end, label: "Close"},
];

export const DURATION = layout.total;
export const sceneFrame = (seconds: number) => Math.round(seconds * FPS);

/** Global film time (s) of a recording mark, e.g. mark("walk.ask-listen"). */
export const mark = (key: string): number => {
  const t = (layout.marks as Record<string, number>)[key];
  if (t === undefined) throw new Error(`no layout mark ${key}`);
  return t;
};
/** Scene-local time (s) of a recording mark; the scene id is the part before the dot. */
export const localMark = (key: string, offset = 0): number => mark(key) - L[key.split(".")[0]].start + offset;
export const segsOf = (sceneId: "walk" | "everyday") =>
  (layout.scenes as unknown as Record<string, {segs: {id: string; src: string; at: number; dur: number; from: number; rate: number}[]}>)[sceneId].segs;
