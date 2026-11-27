import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Mark} from "../../pinpoint-simple/components/Mark";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Close() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const a = interpolate(local, [0.1, 0.7], [0, 1], clamp);
  const b = interpolate(local, [0.9, 1.5], [0, 1], clamp);
  const c = interpolate(local, [4.4, 5.0], [0, 1], clamp);
  const d = interpolate(local, [7.2, 7.9], [0, 1], clamp);
  const e = interpolate(local, [8.2, 8.9], [0, 1], clamp);
  return (
    <AbsoluteFill className="pf-scene">
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 42%, rgba(61,255,138,.1) 0%, rgba(5,7,6,0) 56%)"}} />
      <div style={{position: "absolute", left: 0, right: 0, top: 150, display: "flex", flexDirection: "column", alignItems: "center"}}>
        <div style={{opacity: a, transform: `scale(${interpolate(a, [0, 1], [0.86, 1])})`}}>
          <Mark size={130} draw />
        </div>
        <h1
          style={{
            margin: "30px 0 0",
            fontSize: 104,
            fontWeight: 700,
            letterSpacing: "-4.2px",
            lineHeight: 1.04,
            textAlign: "center",
            opacity: b,
            transform: `translateY(${interpolate(b, [0, 1], [14, 0])}px)`,
          }}
        >
          Steer every agent.
          <br />
          <span style={{color: "#3dff8a"}}>From your glasses.</span>
        </h1>
        <div style={{marginTop: 44, fontSize: 48, letterSpacing: "-.8px", color: "#dbe7df", opacity: c, transform: `translateY(${interpolate(c, [0, 1], [12, 0])}px)`}}>
          <b style={{fontWeight: 700}}>Ring</b> for where. <b style={{fontWeight: 700}}>Voice</b> for what.
        </div>
        <div style={{marginTop: 62, fontSize: 40, color: "#96a69c", opacity: d}}>
          Try it in your browser: <span style={{color: "#3dff8a", fontWeight: 650}}>pinpoint.qolso.com</span>
        </div>
        <div style={{marginTop: 16, fontSize: 34, letterSpacing: ".02em", color: "#b6c4ba", opacity: e}}>
          Works on Even G2 + R1 · Open source
        </div>
      </div>
    </AbsoluteFill>
  );
}
