import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {AGENT_PLAN_TEXT} from "../data";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Hook() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const scroll = interpolate(local, [0.2, 5.7], [0, -650], clamp);
  const cardIn = interpolate(local, [0, 0.5], [0, 1], clamp);
  const noteIn = interpolate(local, [4.45, 4.95], [0, 1], clamp);
  const noteY = interpolate(local, [4.45, 4.95], [26, 0], clamp);

  return (
    <AbsoluteFill className="ps-scene">
      <div
        className="ps-hook-card"
        style={{opacity: cardIn, transform: `translateY(${interpolate(local, [0, 0.5], [16, 0], clamp)}px)`}}
      >
        <div className="ps-hook-bar">
          <span className="ps-hook-dot" />
          <span className="ps-hook-dot" />
          <span className="ps-hook-dot" />
          <span style={{marginLeft: 18}}>Agent</span>
          <span style={{marginLeft: "auto", color: "#526158", fontSize: 17}}>login-fix</span>
        </div>
        <div className="ps-hook-body">
          <div className="ps-hook-text" style={{transform: `translateY(${scroll}px)`}}>
            {AGENT_PLAN_TEXT}
          </div>
          <div className="ps-hook-fade" />
        </div>
      </div>

      <div className="ps-notify" style={{opacity: noteIn, transform: `translateY(${noteY}px)`}}>
        <div className="app">
          <span className="dot" />
          Plan ready
        </div>
        <div className="msg">
          7 steps · <span>needs your OK</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
