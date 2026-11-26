import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Mark} from "../components/Mark";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Answer() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const titleIn = interpolate(local, [0.25, 0.85], [0, 1], clamp);
  const subIn = interpolate(local, [0.8, 1.4], [0, 1], clamp);
  const rule = interpolate(local, [0.6, 1.3], [0, 1], clamp);

  return (
    <AbsoluteFill className="ps-scene ps-answer">
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 50% 46%, rgba(61,255,138,.085) 0%, rgba(5,7,6,0) 55%)",
        }}
      />
      <div className="mark-wrap" style={{opacity: interpolate(local, [0, 0.4], [0, 1], clamp)}}>
        <Mark size={150} draw />
      </div>
      <h1 style={{opacity: titleIn, transform: `translateY(${interpolate(titleIn, [0, 1], [18, 0])}px)`}}>
        Pinpoint
      </h1>
      <div className="rule" style={{transform: `scaleX(${rule})`}} />
      <div className="sub" style={{opacity: subIn, transform: `translateY(${interpolate(subIn, [0, 1], [12, 0])}px)`}}>
        Point at the line. <b>Say the fix.</b>
      </div>
    </AbsoluteFill>
  );
}
