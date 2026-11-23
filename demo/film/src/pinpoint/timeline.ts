export const FPS = 30;
export const DURATION = 165;

export type SceneId = "hook" | "problem" | "alert" | "hero" | "payoff" | "question" | "inbox" | "telegram" | "close";
export type Theme = "dark" | "paper";

export type SceneDef = {
  id: SceneId;
  start: number;
  end: number;
  label: string;
  proof: string;
  theme: Theme;
};

// docs/DEMO.md storyboard, tightened to 2:45 (the brief allows 2:50).
// Every scene component runs inside a Sequence, so its frame is scene-local.
export const SCENES: SceneDef[] = [
  {id: "hook", start: 0, end: 12, label: "THE WALL", proof: "REAL DECK · 7 POINTS", theme: "dark"},
  {id: "problem", start: 12, end: 24, label: "THE GAP", proof: "ILLUSTRATION · NO BRANDS", theme: "paper"},
  {id: "alert", start: 24, end: 33, label: "THE ALERT", proof: "EVEN G2 · SIMULATOR", theme: "dark"},
  {id: "hero", start: 33, end: 93, label: "THE REVIEW", proof: "EVEN G2 · SIMULATOR", theme: "dark"},
  {id: "payoff", start: 93, end: 107, label: "THE PAYOFF", proof: "T3 CODE · ILLUSTRATIVE", theme: "paper"},
  {id: "question", start: 107, end: 120, label: "THE QUESTION", proof: "EVEN G2 · SIMULATOR", theme: "dark"},
  {id: "inbox", start: 120, end: 138, label: "THE INBOX", proof: "INBOX AGENT · ILLUSTRATIVE", theme: "dark"},
  {id: "telegram", start: 138, end: 152, label: "TELEGRAM", proof: "TELEGRAM · ILLUSTRATIVE", theme: "dark"},
  {id: "close", start: 152, end: 165, label: "CLOSE", proof: "OPEN SOURCE", theme: "dark"},
];

export const sceneAtFrame = (frame: number): SceneDef => {
  const seconds = frame / FPS;
  return SCENES.find((scene) => seconds >= scene.start && seconds < scene.end) ?? SCENES[SCENES.length - 1];
};

export const localSeconds = (frame: number, scene: SceneDef) => frame / FPS - scene.start;
