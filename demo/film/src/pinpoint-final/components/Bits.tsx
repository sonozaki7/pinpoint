import {Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {CSSProperties, ReactNode} from "react";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

/** Full-bleed POV photo with the film's morning grade and a slow push. */
export function Photo({src, push = 0.05, pan = 0, style}: {src: string; push?: number; pan?: number; style?: CSSProperties}) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const k = interpolate(frame, [0, durationInFrames], [0, 1], clamp);
  return (
    <>
      <Img
        className="pf-photo"
        src={staticFile(src)}
        style={{transform: `scale(${1.04 + push * k}) translateX(${pan * k}px)`, ...style}}
      />
      <div className="pf-grade" />
    </>
  );
}

/**
 * One G2 lens: a thin green outline around the real simulator frame
 * (1152x576, shown 1:1, nearest-neighbour). Footage or a still.
 */
export function Lens({
  src,
  still,
  startFrom = 0,
  playbackRate = 1,
  style,
  children,
}: {
  src?: string;
  still?: string;
  startFrom?: number;
  playbackRate?: number;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const media: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: 20,
    imageRendering: "pixelated",
    display: "block",
  };
  return (
    <div className="pf-lens pf-lens-main" style={style}>
      {src ? (
        <OffthreadVideo muted src={staticFile(src)} startFrom={Math.round(startFrom * 30)} playbackRate={playbackRate} style={media} />
      ) : null}
      {still ? <Img src={staticFile(still)} style={media} /> : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 28,
          background: "linear-gradient(120deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,0) 28%, rgba(0,0,0,.16) 100%)",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
}

/** "Real" (green) or "Sample" (amber) provenance tag. */
export function Tag({children, sample = false, style}: {children: ReactNode; sample?: boolean; style?: CSSProperties}) {
  return (
    <span className={`pf-tag${sample ? " is-sample" : ""}`} style={style}>
      <span className="dot" />
      {children}
    </span>
  );
}

/** Line-art ring, drawn for this film. Modes: scroll, tap, hold, idle. */
export function RingIcon({local, mode, size = 150}: {local: number; mode: "scroll" | "tap" | "talk" | "idle"; size?: number}) {
  const angle = ((local % 2.2) / 2.2) * 300;
  const pulse = (offset: number) => {
    const t = (local - offset) % 1.5;
    if (local < offset) return null;
    const k = t / 1.5;
    return {r: 52 + k * 38, o: (1 - k) * 0.75};
  };
  const p = mode === "tap" ? pulse(0.05) : null;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden>
      <g fill="none" stroke="#3dff8a" strokeLinecap="round" style={{filter: "drop-shadow(0 0 8px rgba(61,255,138,.5))"}}>
        <circle cx="100" cy="100" r="58" strokeWidth="9" opacity="0.92" />
        <circle cx="100" cy="100" r="44" strokeWidth="4" opacity="0.42" />
        <path d="M100 30v-9M100 179v-9" strokeWidth="4" opacity="0.35" />
        {mode === "scroll" ? (
          <g transform={`rotate(${angle} 100 100)`}>
            <path d="M100 16a84 84 0 0 1 73 42" strokeWidth="6" />
            <path d="M173 42l1 19-17-9" strokeWidth="6" strokeLinejoin="round" />
          </g>
        ) : null}
        {p ? <circle cx="100" cy="100" r={p.r} strokeWidth="3" opacity={p.o} /> : null}
        {mode === "tap" ? <circle cx="100" cy="100" r="11" fill="#3dff8a" stroke="none" opacity="0.9" /> : null}
      </g>
    </svg>
  );
}

export function MicIcon({local, size = 110}: {local: number; size?: number}) {
  const level = 0.55 + 0.45 * Math.abs(Math.sin(local * 5.2));
  return (
    <svg viewBox="0 0 96 140" width={size * 0.69} height={size} aria-hidden>
      <g fill="none" stroke="#3dff8a" strokeWidth="5" strokeLinecap="round" style={{filter: "drop-shadow(0 0 8px rgba(61,255,138,.5))"}}>
        <rect x="33" y="10" width="30" height="62" rx="15" />
        <path d="M22 58v8a26 26 0 0 0 52 0v-8" opacity="0.8" />
        <path d="M48 92v22M34 120h28" opacity="0.8" />
        <path d="M74 44v26" opacity={0.25 + 0.55 * level} />
        <path d="M83 36v42" opacity={0.2 + 0.5 * level} />
      </g>
    </svg>
  );
}
