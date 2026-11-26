import {AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {Lens} from "../components/Lens";
import {Mic} from "../components/Mic";
import {Ring} from "../components/Ring";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const ff = (seconds: number) => Math.round(seconds * 30);

export function How() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;

  const step = local < 4.8 ? 0 : local < 12.6 ? 1 : 2;
  const ringMode = local < 4.8 ? "scroll" : local < 12.6 ? "tap" : local < 19.0 ? "double" : "idle";
  const micIn = interpolate(local, [4.85, 5.05, 12.4, 12.65], [0, 1, 1, 0], clamp);
  const sentScale = interpolate(local, [19.0, 26], [1, 1.018], clamp);

  const labels = ["Scroll", "Tap and talk", "Tap twice to send"];

  return (
    <AbsoluteFill className="ps-scene">
      <Img className="ps-photo" src={staticFile("stills/train-window.jpg")} />
      <div className="ps-vignette" />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 460,
          background: "linear-gradient(90deg, rgba(3,5,4,.9) 0%, rgba(3,5,4,.62) 55%, rgba(3,5,4,0) 100%)",
        }}
      />

      <Sequence from={ff(0)} durationInFrames={ff(4.8)} premountFor={18}>
        <Lens src="clips/plan-review.mp4" startFrom={3.2} playbackRate={1.1} className="ps-how-lens" />
      </Sequence>
      <Sequence from={ff(4.8)} durationInFrames={ff(7.0)} premountFor={18}>
        <Lens src="clips/plan-review.mp4" startFrom={8.3} playbackRate={0.8} className="ps-how-lens" />
      </Sequence>
      <Sequence from={ff(11.8)} durationInFrames={ff(7.2)} premountFor={18}>
        <Lens src="clips/plan-review.mp4" startFrom={13.9} playbackRate={1.14} className="ps-how-lens" />
      </Sequence>
      <Sequence from={ff(19.0)} durationInFrames={ff(7.0)} premountFor={18}>
        <Lens
          still="clips/stills/sent.png"
          className="ps-how-lens"
          chip="Sent"
          imageStyle={{transform: `scale(${sentScale})`}}
          coverBottom
        />
      </Sequence>

      <div className="ps-steps">
        {labels.map((label, i) => (
          <div key={label} className={`ps-step-label${i === step ? " is-on" : ""}`}>
            <span className="n">{i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <Ring local={local} mode={ringMode} />
      {micIn > 0.01 ? (
        <div style={{opacity: micIn}}>
          <Mic local={local} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
