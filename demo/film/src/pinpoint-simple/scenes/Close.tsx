import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Mark} from "../components/Mark";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Close() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const a = interpolate(local, [0.1, 0.5], [0, 1], clamp);
  const b = interpolate(local, [0.5, 0.9], [0, 1], clamp);
  const c = interpolate(local, [0.9, 1.4], [0, 1], clamp);
  const d = interpolate(local, [1.5, 2.0], [0, 1], clamp);

  return (
    <AbsoluteFill className="ps-scene ps-close">
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 50% 44%, rgba(61,255,138,.10) 0%, rgba(5,7,6,0) 58%)",
        }}
      />
      <div className="mark-wrap" style={{opacity: a}}>
        <Mark size={150} draw />
      </div>
      <h1 style={{opacity: b, transform: `translateY(${interpolate(b, [0, 1], [14, 0])}px)`}}>Pinpoint</h1>
      <div className="tag" style={{opacity: c}}>
        <b>Ring</b> for where. <b>Voice</b> for what.
      </div>
      <div className="url" style={{opacity: d}}>pinpoint.qolso.com</div>
      <div className="small" style={{opacity: d}}>Open source · Even G2 + R1 · Telegram</div>
    </AbsoluteFill>
  );
}
