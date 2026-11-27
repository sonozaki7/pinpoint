import {Tag} from "../components/Bits";
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

const CARDS = [
  {kind: "A risky step", at: 6.5, pre: "Step 4: ", hot: "Sign out every customer", post: " once", note: "can't be undone", icon: "!"},
  {kind: "A wrong number", at: 7.8, pre: "We agree to ", hot: "net-60", post: " payment terms", note: "your notes say net-45", icon: "#"},
  {kind: "A promise you can't keep", at: 8.9, pre: "Available to ", hot: "every customer today", post: "", note: "the rollout is staged", icon: "?"},
];

export function Problem() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;

  const decisionIn = interpolate(local, [0.1, 0.7], [0, 1], clamp);
  const decisionOut = interpolate(local, [4.0, 4.6], [1, 0], clamp);
  const pointAt = 12.0;

  return (
    <AbsoluteFill className="pf-scene">
      <div style={{position: "absolute", right: 64, top: 40}}>
        <Tag sample>Illustration</Tag>
      </div>
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 44%, rgba(30,74,52,.16) 0%, rgba(5,7,6,0) 60%)"}} />

      {/* two buttons */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 170,
          display: "flex",
          justifyContent: "center",
          opacity: decisionIn * decisionOut,
          transform: `translateY(${interpolate(decisionIn, [0, 1], [24, 0])}px)`,
        }}
      >
        <div className="pf-card" style={{width: 980, padding: "54px 64px 56px"}}>
          <div className="pf-kicker" style={{marginBottom: 22}}>An agent is waiting · login-fix</div>
          <div style={{fontSize: 60, fontWeight: 700, letterSpacing: "-2px", lineHeight: 1.1}}>Approve the plan?</div>
          <div style={{fontSize: 30, color: "#96a69c", marginTop: 14, letterSpacing: "-.2px"}}>7 steps · seven lines of text</div>
          <div style={{display: "flex", gap: 22, marginTop: 44}}>
            <div style={{flex: 1, textAlign: "center", padding: "24px 0", borderRadius: 16, background: "#2f7d52", fontSize: 38, fontWeight: 650}}>Approve</div>
            <div style={{flex: 1, textAlign: "center", padding: "24px 0", borderRadius: 16, background: "#2a2f2c", fontSize: 38, fontWeight: 650, color: "#c3cec7"}}>Decline</div>
          </div>
        </div>
      </div>

      {/* almost right */}
      <div style={{position: "absolute", left: 0, right: 0, top: 118, textAlign: "center", opacity: interpolate(local, [4.5, 5.1], [0, 1], clamp)}}>
        <div className="pf-big" style={{fontSize: 84}}>
          The work is <span style={{color: "#ffc46b"}}>almost</span> right.
        </div>
      </div>

      <div style={{position: "absolute", left: 80, right: 80, top: 330, display: "flex", gap: 36, justifyContent: "center"}}>
        {CARDS.map((c) => {
          const k = interpolate(local, [c.at, c.at + 0.45], [0, 1], clamp);
          const hot = interpolate(local, [pointAt, pointAt + 0.5], [0, 1], clamp);
          return (
            <div
              key={c.kind}
              className="pf-card"
              style={{
                width: 540,
                padding: "34px 38px 38px",
                opacity: k,
                transform: `translateY(${interpolate(k, [0, 1], [30, 0])}px)`,
              }}
            >
              <div style={{display: "flex", alignItems: "center", gap: 14}}>
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "#ffc46b",
                    color: "#2a1a04",
                    fontWeight: 800,
                    fontSize: 24,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {c.icon}
                </span>
                <span style={{fontSize: 22, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#ffc46b"}}>{c.kind}</span>
              </div>
              <div style={{fontSize: 38, lineHeight: 1.3, marginTop: 24, letterSpacing: "-.5px", color: "#dfe9e2"}}>
                {c.pre}
                <span
                  style={{
                    padding: "0 4px",
                    borderRadius: 4,
                    background: `rgba(255,196,107,${0.06 + 0.2 * hot})`,
                    boxShadow: `inset 0 -3px 0 rgba(255,196,107,${0.35 + 0.5 * hot})`,
                    color: "#fff3df",
                  }}
                >
                  {c.hot}
                </span>
                {c.post}
              </div>
              <div style={{marginTop: 22, fontSize: 24, color: "#96a69c", opacity: hot}}>→ {c.note}</div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 760,
          textAlign: "center",
          fontSize: 38,
          color: "#96a69c",
          letterSpacing: "-.4px",
          opacity: interpolate(local, [pointAt - 0.2, pointAt + 0.5], [0, 1], clamp),
        }}
      >
        Not <b style={{color: "#c3cec7"}}>Decline</b>. A <b style={{color: "#eef5f0"}}>note on the exact line</b>.
      </div>
    </AbsoluteFill>
  );
}
