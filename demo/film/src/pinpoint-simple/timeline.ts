export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const DURATION = 103;

export type SimpleSceneId =
  | "hook"
  | "context"
  | "problem"
  | "answer"
  | "how"
  | "result"
  | "telegram"
  | "more"
  | "close";

export type SimpleScene = {id: SimpleSceneId; start: number; end: number; label: string};

export const SCENES: SimpleScene[] = [
  {id: "hook", start: 0, end: 7, label: "Hook"},
  {id: "context", start: 7, end: 13, label: "Context"},
  {id: "problem", start: 13, end: 30, label: "Problem"},
  {id: "answer", start: 30, end: 36, label: "Answer"},
  {id: "how", start: 36, end: 62, label: "How"},
  {id: "result", start: 62, end: 75, label: "Result"},
  {id: "telegram", start: 75, end: 85, label: "Telegram"},
  {id: "more", start: 85, end: 95, label: "More"},
  {id: "close", start: 95, end: 103, label: "Close"},
];

export const sceneFrame = (seconds: number) => Math.round(seconds * FPS);
