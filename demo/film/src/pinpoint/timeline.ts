export const FPS = 30;
export const DURATION = 140;

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

// v2 cut: scenes are timed to the real recordings, not the old stills.
// hook 12 · problem 11 · alert 9 · hero 27 (22.8 s live + 1.9 s cleared inbox)
// payoff 17 · question 10 (8.2 s clip) · inbox 20 (16.1 s clip) · telegram 14 · close 20.
// Total 2:20, inside the 2:50 brief.
export const SCENES: SceneDef[] = [
  {id: "hook", start: 0, end: 12, label: "THE WALL", proof: "REAL DECK · 7 POINTS", theme: "dark"},
  {id: "problem", start: 12, end: 23, label: "THE GAP", proof: "ILLUSTRATION · NO BRANDS", theme: "paper"},
  {id: "alert", start: 23, end: 32, label: "THE ALERT", proof: "EVEN G2 · REAL + ILLUSTRATIVE PHONE", theme: "dark"},
  {id: "hero", start: 32, end: 59, label: "THE REVIEW", proof: "EVEN G2 · REAL RECORDING", theme: "dark"},
  {id: "payoff", start: 59, end: 76, label: "THE PAYOFF", proof: "T3 CODE · REAL THREAD", theme: "paper"},
  {id: "question", start: 76, end: 86, label: "THE QUESTION", proof: "EVEN G2 · REAL RECORDING", theme: "dark"},
  {id: "inbox", start: 86, end: 106, label: "THE INBOX", proof: "EVEN G2 · REAL RECORDING", theme: "dark"},
  {id: "telegram", start: 106, end: 120, label: "TELEGRAM", proof: "TELEGRAM · PLACEHOLDER", theme: "dark"},
  {id: "close", start: 120, end: 140, label: "CLOSE", proof: "OPEN SOURCE", theme: "dark"},
];

export const sceneAtFrame = (frame: number): SceneDef => {
  const seconds = frame / FPS;
  return SCENES.find((scene) => seconds >= scene.start && seconds < scene.end) ?? SCENES[SCENES.length - 1];
};

export const localSeconds = (frame: number, scene: SceneDef) => frame / FPS - scene.start;
