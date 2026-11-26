import {AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {Lens} from "../components/Lens";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const ff = (seconds: number) => Math.round(seconds * 30);

export function More() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const zoom = interpolate(local, [6.7, 10], [1, 1.035], clamp);
  const zoomSecond = interpolate(local, [3.6, 6.7], [1, 1.03], clamp);

  return (
    <AbsoluteFill className="ps-scene">
      <Sequence from={ff(0)} durationInFrames={ff(3.6)} premountFor={18}>
        <Lens src="clips/payment-question.mp4" startFrom={6.1} playbackRate={0.9} className="ps-more-lens" />
      </Sequence>
      <Sequence from={ff(3.6)} durationInFrames={ff(3.1)} premountFor={18}>
        <Lens
          still="clips/stills/morning-noted.png"
          className="ps-more-lens"
          imageStyle={{transform: `scale(${zoomSecond})`}}
        />
      </Sequence>
      <Sequence from={ff(6.7)} durationInFrames={ff(3.3)} premountFor={18}>
        <Lens
          still="clips/stills/inbox.png"
          className="ps-more-lens"
          imageStyle={{transform: `scale(${zoom})`}}
        />
      </Sequence>

      <div className="ps-more-tag" style={{opacity: interpolate(local, [0.2, 0.6], [0, 1], clamp)}}>
        EVEN G2 · APP FOOTAGE
      </div>
    </AbsoluteFill>
  );
}
