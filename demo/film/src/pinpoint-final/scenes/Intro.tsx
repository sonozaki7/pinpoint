import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Mark} from "../../pinpoint-simple/components/Mark";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Intro() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const a = interpolate(local, [0.2, 0.9], [0, 1], clamp);
  const b = interpolate(local, [0.8, 1.5], [0, 1], clamp);
  const lines = [
    {t: "Only what needs you.", at: 5.6},
    {t: "Point at the line.", at: 6.8},
    {t: "Say the fix.", at: 7.9},
  ];
  return (
    <AbsoluteFill className="pf-scene">
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 42%, rgba(61,255,138,.1) 0%, rgba(5,7,6,0) 56%)"}} />
      <div style={{position: "absolute", left: 0, right: 0, top: 118, display: "flex", flexDirection: "column", alignItems: "center"}}>
        <div style={{opacity: a, transform: `scale(${interpolate(a, [0, 1], [0.86, 1])})`}}>
          <Mark size={150} draw />
        </div>
        <h1 style={{margin: "26px 0 0", fontSize: 124, fontWeight: 680, letterSpacing: "-5px", lineHeight: 1, opacity: b}}>Pinpoint</h1>
        <div style={{marginTop: 22, fontSize: 40, color: "#96a69c", letterSpacing: "-.5px", opacity: interpolate(local, [1.2, 1.9], [0, 1], clamp)}}>
          The attention layer on your glasses
        </div>
        <div style={{marginTop: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 6}}>
          {lines.map((l, i) => {
            const k = interpolate(local, [l.at, l.at + 0.4], [0, 1], clamp);
            return (
              <div
                key={l.t}
                style={{
                  fontSize: 64,
                  fontWeight: 700,
                  letterSpacing: "-2px",
                  color: i === 2 ? "#3dff8a" : "#eef5f0",
                  opacity: k,
                  transform: `translateY(${interpolate(k, [0, 1], [14, 0])}px)`,
                }}
              >
                {l.t}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}
