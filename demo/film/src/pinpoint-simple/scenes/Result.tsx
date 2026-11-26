import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Lens} from "../components/Lens";
import {AGENT_REPLY, PROOF_LINE, REVIEW_TEXT} from "../data";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Result() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const cardIn = interpolate(local, [0.25, 0.9], [0, 1], clamp);
  const reviewIn = interpolate(local, [0.8, 1.4], [0, 1], clamp);
  const replyIn = interpolate(local, [6.1, 6.7], [0, 1], clamp);
  const replyY = interpolate(local, [6.1, 6.7], [18, 0], clamp);
  const scale = interpolate(local, [0, 13], [1, 1.012], clamp);

  const lines = REVIEW_TEXT.split("\n");
  const head = lines[0] ?? "";
  const body = lines.slice(1);

  return (
    <AbsoluteFill className="ps-scene">
      <Lens
        still="clips/stills/sent.png"
        className="ps-sent-lens"
        chip="Sent"
        imageStyle={{transform: `scale(${scale})`}}
        coverBottom
      />

      <div className="ps-card ps-result-card" style={{opacity: cardIn, transform: `translateY(${interpolate(cardIn, [0, 1], [18, 0])}px)`}}>
        <div className="head">What your agent gets</div>
        <div className="ps-review" style={{opacity: reviewIn}}>
          <div style={{color: "#8fa298", fontSize: 18, marginBottom: 10}}>{head}</div>
          {body.map((line) => {
            const bad = line.startsWith("✗");
            const good = line.startsWith("✓");
            return (
              <div key={line} className={bad ? "obj" : good ? "agree" : undefined} style={{marginBottom: 12}}>
                {line}
              </div>
            );
          })}
        </div>
        <div className="ps-reply" style={{opacity: replyIn, transform: `translateY(${replyY}px)`}}>
          <span className="who">Agent</span>
          {AGENT_REPLY}
        </div>
      </div>

      <div className="ps-proof">{PROOF_LINE}</div>
    </AbsoluteFill>
  );
}
