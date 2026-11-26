import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Context() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const lensIn = interpolate(local, [0.2, 0.9], [0, 1], clamp);
  const noteIn = interpolate(local, [0.9, 1.5], [0, 1], clamp);
  const noteScale = interpolate(local, [0.9, 1.5], [0.96, 1], clamp);

  return (
    <AbsoluteFill className="ps-scene">
      <Img className="ps-photo" src={staticFile("stills/train-window.jpg")} />
      <div className="ps-vignette" />

      <div
        className="ps-lens ps-context-lens"
        style={{opacity: lensIn, background: "rgba(0,0,0,0.10)"}}
      >
        <div className="ps-glass-note" style={{opacity: noteIn, transform: `translate(-50%, -50%) scale(${noteScale})`}}>
          <div className="kicker">On your glasses</div>
          <div className="line">login-fix · plan, 7 steps</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
