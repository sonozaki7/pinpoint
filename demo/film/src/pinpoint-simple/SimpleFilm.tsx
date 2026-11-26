import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import type {ReactNode} from "react";
import "./simple.css";
import {Captions} from "./components/Captions";
import {DURATION, FPS, SCENES, sceneFrame, type SimpleSceneId} from "./timeline";
import {Hook} from "./scenes/Hook";
import {Context} from "./scenes/Context";
import {Problem} from "./scenes/Problem";
import {Answer} from "./scenes/Answer";
import {How} from "./scenes/How";
import {Result} from "./scenes/Result";
import {Telegram} from "./scenes/Telegram";
import {More} from "./scenes/More";
import {Close} from "./scenes/Close";

const COMPONENTS: Record<SimpleSceneId, () => ReactNode> = {
  hook: Hook,
  context: Context,
  problem: Problem,
  answer: Answer,
  how: How,
  result: Result,
  telegram: Telegram,
  more: More,
  close: Close,
};

/** Calm 10-frame fade in/out around each scene so cuts never snap. */
function SceneFade({children, frames, last}: {children: ReactNode; frames: number; last: boolean}) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const fadeOut = interpolate(frame, [frames - 14, frames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = last
    ? interpolate(frame, [frames - 30, frames], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : Math.min(fadeIn, fadeOut);
  return <AbsoluteFill style={{opacity}}>{children}</AbsoluteFill>;
}

export function PinpointSimple() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill className="ps-root">
      {SCENES.map((scene) => {
        const Scene = COMPONENTS[scene.id];
        const from = sceneFrame(scene.start);
        const frames = sceneFrame(scene.end) - from;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={frames} premountFor={18}>
            <SceneFade frames={frames} last={scene.id === "close"}>
              <Scene />
            </SceneFade>
          </Sequence>
        );
      })}

      <Captions />
      <Audio src={staticFile("audio/simple-voice.wav")} />
      <AbsoluteFill
        style={{
          background: "#000",
          opacity: interpolate(frame, [0, 8], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}

export const SIMPLE_DURATION = DURATION * FPS;
