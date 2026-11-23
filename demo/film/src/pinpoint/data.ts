import clipsJson from "../clips.json";
import captionsJson from "./captions.generated.json";
import {SCENES, type SceneDef, type SceneId} from "./timeline";

export type SourceConfig =
  | {kind: "design"}
  | {kind: "clip"; src: string; startAt?: number}
  | {
      kind: "frames";
      dir: string;
      fps?: number;
      count?: number;
      meta?: string;
      timeline?: string;
      sceneId?: string;
      pattern?: string;
    };

export type RingInput = {
  at: number;
  kind: "swipe" | "tap" | "talk" | "double";
  label: string;
  note?: string;
};

export type SceneConfig = {
  status?: string;
  note?: string;
  source?: SourceConfig | null;
  stills?: Record<string, string>;
  inputs?: RingInput[];
};

export type Clips = {
  audio: {narration: string; bed?: string | null; bedVolume?: number; note?: string};
  scenes: Record<SceneId, SceneConfig>;
};

export type Cue = {id: string; start: number; end: number; text: string; seconds: number};

export const clips = clipsJson as unknown as Clips;
export const scenes = clips.scenes;
export const sceneConfig = (id: SceneId): SceneConfig => clips.scenes[id] ?? {};
export const captions = (captionsJson as {cues: Cue[]}).cues;
export const sceneDef = (id: SceneId): SceneDef => SCENES.find((scene) => scene.id === id) ?? SCENES[0];
