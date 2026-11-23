import {AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import {clips} from "./data";
import {DURATION, FPS, SCENES} from "./timeline";
import {Captions, FrameHud, ff} from "./ui";
import {Alert} from "./scenes/Alert";
import {Close} from "./scenes/Close";
import {Hero} from "./scenes/Hero";
import {Hook} from "./scenes/Hook";
import {Inbox} from "./scenes/Inbox";
import {Payoff} from "./scenes/Payoff";
import {Problem} from "./scenes/Problem";
import {Question} from "./scenes/Question";
import {Telegram} from "./scenes/Telegram";
import "./pinpoint.css";

const COMPONENTS = {
  hook: Hook,
  problem: Problem,
  alert: Alert,
  hero: Hero,
  payoff: Payoff,
  question: Question,
  inbox: Inbox,
  telegram: Telegram,
  close: Close,
} as const;

export function PinpointDemo() {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 10], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const fadeOut = interpolate(frame, [ff(DURATION - 0.75), ff(DURATION) - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const black = Math.max(fadeIn, fadeOut);

  return (
    <AbsoluteFill className="pp-root">
      {SCENES.map((scene) => {
        const Scene = COMPONENTS[scene.id];
        return (
          <Sequence
            key={scene.id}
            from={ff(scene.start)}
            durationInFrames={ff(scene.end) - ff(scene.start)}
            premountFor={18}
          >
            <Scene />
          </Sequence>
        );
      })}

      <FrameHud />
      <Captions />

      {clips.audio.narration ? <Audio src={staticFile(clips.audio.narration)} /> : null}
      {clips.audio.bed ? <Audio src={staticFile(clips.audio.bed)} volume={clips.audio.bedVolume ?? 0.5} /> : null}

      <AbsoluteFill style={{background: "#000", opacity: black, pointerEvents: "none"}} />
    </AbsoluteFill>
  );
}

export const PINPOINT_DURATION = DURATION * FPS;
