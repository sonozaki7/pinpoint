import {AbsoluteFill, interpolate, interpolateColors, useCurrentFrame, useVideoConfig} from "remotion";
import {BAD_STEP, PLAN} from "../data";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Problem() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;

  const approveOut = interpolate(local, [4.1, 4.8], [1, 0], clamp);
  const listIn = interpolate(local, [4.5, 5.3], [0, 1], clamp);
  const redK = interpolate(local, [5.2, 5.9], [0, 1], clamp);
  const outcome1 = interpolate(local, [9.5, 10.1], [0, 1], clamp);
  const outcome2 = interpolate(local, [11.1, 11.7], [0, 1], clamp);
  const listY = interpolate(local, [4.5, 5.3], [18, 0], clamp);

  return (
    <AbsoluteFill className="ps-scene">
      <div
        className="ps-approve"
        style={{opacity: approveOut, transform: `translate(-50%, -50%) scale(${interpolate(local, [0, 0.5], [0.97, 1], clamp)})`}}
      >
        <div className="title">Approve plan?</div>
        <div className="sub">7 steps · one tap each</div>
        <div className="buttons">
          <div className="button yes">Yes</div>
          <div className="button">No</div>
        </div>
      </div>

      <div className="ps-plan-list" style={{opacity: listIn, transform: `translateY(${listY}px)`}}>
        <div className="ps-plan-head">
          <span className="name">Login fix: 7-step plan</span>
          <span className="meta">one line per step</span>
        </div>
        {PLAN.map((text, i) => {
          const n = i + 1;
          const bad = n === BAD_STEP;
          const color = bad ? interpolateColors(redK, [0, 1], ["#dbe6df", "#ff5c5c"]) : undefined;
          const rowIn = interpolate(local, [4.6 + i * 0.05, 4.9 + i * 0.05], [0, 1], clamp);
          return (
            <div
              key={n}
              className={`ps-plan-row${bad && redK > 0.5 ? " is-bad" : ""}`}
              style={{color, opacity: rowIn, transform: `translateX(${interpolate(rowIn, [0, 1], [-10, 0])}px)`}}
            >
              <span className="num">{n}</span>
              <span>{text}</span>
              {bad ? <span className="badge" style={{opacity: redK}}>!</span> : null}
            </div>
          );
        })}
      </div>

      <div className="ps-outcomes">
        <div className="ps-outcome bad" style={{opacity: outcome1}}>
          <span className="arrow">→</span>
          <span>Yes: every customer signed out.</span>
        </div>
        <div className="ps-outcome good" style={{opacity: outcome2}}>
          <span className="arrow">→</span>
          <span>No: six good steps thrown away.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
