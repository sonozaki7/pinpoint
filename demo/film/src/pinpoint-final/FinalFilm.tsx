import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import type {ReactNode} from "react";
import "./final.css";
import {Captions} from "./components/Captions";
import {DURATION, FPS, SCENES, sceneFrame, type FinalSceneId} from "./timeline";
import {Hook} from "./scenes/Hook";
import {Problem} from "./scenes/Problem";
import {Intro} from "./scenes/Intro";
import {FootageScene} from "./scenes/FootageScene";
import {Proof} from "./scenes/Proof";
import {Close} from "./scenes/Close";
import {EVERYDAY, WALK} from "./footage";

const COMPONENTS: Record<FinalSceneId, () => ReactNode> = {
  hook: Hook,
  problem: Problem,
  intro: Intro,
  walk: () => <FootageScene {...WALK} />,
  everyday: () => <FootageScene {...EVERYDAY} />,
  proof: Proof,
  close: Close,
};

/** Calm fade around each scene so cuts never snap. */
function SceneFade({children, frames, last}: {children: ReactNode; frames: number; last: boolean}) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const fadeOut = interpolate(frame, [frames - 12, frames], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const opacity = last
    ? interpolate(frame, [frames - 30, frames], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : Math.min(fadeIn, fadeOut);
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
}

export function PinpointFinal() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="pf-root">
      {SCENES.map((scene) => {
        const Scene = COMPONENTS[scene.id];
        const from = sceneFrame(scene.start);
        const frames = sceneFrame(scene.end) - from;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={frames} premountFor={20}>
            <SceneFade frames={frames} last={scene.id === "close"}>
              <Scene />
            </SceneFade>
          </Sequence>
        );
      })}
      <Captions />
      <Audio src={staticFile("audio/final-voice.wav")} />
      <AbsoluteFill
        style={{
          background: "#000",
          opacity: interpolate(frame, [0, 8], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}

export const FINAL_DURATION = Math.ceil(DURATION * FPS);
