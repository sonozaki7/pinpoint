import {useEffect, useMemo, useState, type CSSProperties, type ReactNode} from "react";
import {
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {captions, sceneConfig, type RingInput, type SourceConfig} from "./data";
import {FPS, SCENES, sceneAtFrame, type SceneId} from "./timeline";

export const ff = (seconds: number) => Math.round(seconds * FPS);
export const clampOpts = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
export const easeOut = Easing.bezier(0.2, 0.78, 0.2, 1);
export const easeIn = Easing.bezier(0.55, 0, 0.9, 0.35);
export const easeInOut = Easing.bezier(0.55, 0.02, 0.25, 1);
export const phase = (frame: number, fromSec: number, toSec: number, easing = easeOut) =>
  interpolate(frame, [ff(fromSec), ff(toSec)], [0, 1], {...clampOpts, easing});
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const fadeEdges = (frame: number, startSec: number, endSec: number, edge = 0.22) =>
  Math.min(phase(frame, startSec, startSec + edge), 1 - phase(frame, endSec - edge, endSec));

export function Mark({size = 28, width = 1.6}: {size?: number; width?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="pp-mark">
      <circle cx="20" cy="20" r="13.4" stroke="currentColor" strokeOpacity="0.38" strokeWidth={width} />
      <circle cx="20" cy="20" r="7.2" stroke="currentColor" strokeWidth={width} />
      <circle cx="20" cy="20" r="2.1" fill="currentColor" />
      <path
        d="M20 1.6v4.8M20 33.6v4.8M1.6 20h4.8M33.6 20h4.8"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeOpacity="0.62"
      />
    </svg>
  );
}

export function Lens({
  children,
  style,
  label = "EVEN G2",
  meta = "576 × 288 · GREEN DISPLAY",
  labelRight,
}: {
  children: ReactNode;
  style?: CSSProperties;
  label?: string | null;
  meta?: string | null;
  labelRight?: ReactNode;
}) {
  return (
    <div className="pp-lens-wrap" style={style}>
      <div className="pp-lens-glow" />
      {label ? (
        <div className="pp-lens-label">
          <i />
          {label}
        </div>
      ) : null}
      <div className="pp-lens">
        <div className="pp-lens-screen">
          {children}
          <div className="pp-lens-scan" />
          <div className="pp-lens-vignette" />
        </div>
        <div className="pp-lens-reflection" />
      </div>
      {meta ? <div className="pp-lens-meta">{meta}</div> : null}
      {labelRight}
    </div>
  );
}

export function Still({src, flash = 0}: {src: string; flash?: number}) {
  return (
    <>
      <Img src={staticFile(src)} style={{display: "block", width: 1152, height: 576, imageRendering: "pixelated"}} />
      {flash > 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(0deg, rgba(185,252,169,.55), rgba(185,252,169,0))",
            opacity: flash,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </>
  );
}

// Renders a configured clip or frame folder inside the lens. The stills path
// lives in each scene; this is the one place a real recording plugs in.
export function SourceRenderer({
  source,
  width = 1152,
  height = 576,
  fit = "cover",
}: {
  source: SourceConfig;
  width?: number;
  height?: number;
  fit?: "cover" | "contain";
}) {
  if (source.kind === "clip") {
    const video = (
      <OffthreadVideo
        src={staticFile(source.src)}
        muted
        startFrom={ff(source.startAt ?? 0)}
        style={{display: "block", width, height, objectFit: fit}}
      />
    );
    if (source.delay) {
      return <Sequence from={ff(source.delay)}>{video}</Sequence>;
    }
    return video;
  }
  if (source.kind === "frames") return <FrameFolder source={source} width={width} height={height} fit={fit} />;
  return null;
}

function FrameFolder({
  source,
  width,
  height,
  fit,
}: {
  source: Extract<SourceConfig, {kind: "frames"}>;
  width: number;
  height: number;
  fit: "cover" | "contain";
}) {
  const frame = useCurrentFrame();
  const [info, setInfo] = useState<{fps: number; count: number} | null>(null);
  const [failed, setFailed] = useState(false);
  const handle = useMemo(() => delayRender(`pinpoint frames ${source.dir}`), [source.dir]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (source.timeline) {
          const response = await fetch(staticFile(source.timeline));
          const timeline = (await response.json()) as {
            captureMs?: number;
            frames?: {scene?: string}[];
          };
          const frames = source.sceneId
            ? (timeline.frames ?? []).filter((item) => item.scene === source.sceneId)
            : (timeline.frames ?? []);
          if (!cancelled) {
            setInfo({
              fps: source.fps ?? (timeline.captureMs ? 1000 / timeline.captureMs : 10),
              count: source.count ?? frames.length,
            });
          }
        } else {
          const response = await fetch(staticFile(source.meta ?? `${source.dir}/meta.json`));
          const meta = (await response.json()) as {fps?: number; frames?: number};
          if (!cancelled) {
            setInfo({
              fps: source.fps ?? meta.fps ?? 10,
              count: source.count ?? meta.frames ?? 0,
            });
          }
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        continueRender(handle);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [handle, source.count, source.dir, source.fps, source.meta, source.sceneId, source.timeline]);

  if (failed) {
    return (
      <div style={{display: "grid", placeItems: "center", height, fontFamily: "IBM Plex Mono", fontSize: 20, color: "#86ff70"}}>
        clip not found · {source.dir}
      </div>
    );
  }
  if (!info || info.count === 0) return null;
  const index = Math.max(1, Math.min(info.count, Math.floor((frame / FPS) * info.fps) + 1));
  const name = `${source.dir}/${String(index).padStart(5, "0")}.png`;
  return <Img src={staticFile(name)} style={{display: "block", width, height, objectFit: fit, imageRendering: "pixelated"}} />;
}

export const sceneSource = (id: SceneId): SourceConfig | null => sceneConfig(id).source ?? null;

export function RingGlyph({kind, size = 30}: {kind: RingInput["kind"]; size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <ellipse cx="24" cy="28" rx="13.5" ry="7.4" stroke="currentColor" strokeWidth="2" opacity="0.9" />
      <ellipse cx="24" cy="27" rx="7.4" ry="3.7" stroke="currentColor" strokeWidth="1.1" opacity="0.45" />
      <path d="M12 24a13.5 7.4 0 0 1 12-6.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="24" cy="16.4" r="2.2" fill="currentColor" />
      {kind === "swipe" ? (
        <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity="0.9">
          <path d="M40 12v9m0-9 3 3m-3-3-3 3M40 40v-9m0 9 3-3m-3 3-3-3" />
        </g>
      ) : null}
      {kind === "tap" ? (
        <g stroke="currentColor" strokeWidth="1.5" opacity="0.85">
          <circle cx="24" cy="16.4" r="6.4" />
          <circle cx="24" cy="16.4" r="10.4" opacity="0.45" />
        </g>
      ) : null}
      {kind === "talk" ? (
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.9">
          <path d="M17 42v-4M20.5 42v-7M24 42v-11M27.5 42v-6M31 42v-3" />
        </g>
      ) : null}
      {kind === "double" ? (
        <g stroke="currentColor" strokeWidth="1.6" opacity="0.9">
          <path d="M38 14l3 3m-3-3 3-3M38 26l3 3m-3-3 3-3" />
        </g>
      ) : null}
    </svg>
  );
}

export function GestureChip({
  input,
  style,
  localFrame,
  compact = false,
}: {
  input: RingInput;
  style?: CSSProperties;
  localFrame: number;
  compact?: boolean;
}) {
  const t = localFrame / FPS - input.at;
  const enter = Math.min(1, Math.max(0, t / 0.22));
  const retire = 1 - Math.min(1, Math.max(0, (t - 4.2) / 0.6));
  const scale = 0.97 + 0.03 * easeOut(t >= 0 ? Math.min(1, t / 0.3) : 0);
  const ripple = input.kind === "tap" ? Math.max(0, 1 - t / 0.7) : 0;
  return (
    <div
      className={`pp-input ${compact ? "compact" : ""}`}
      style={{...style, opacity: enter * retire, transform: `translateY(${(1 - enter) * 10}px) scale(${scale})`}}
    >
      <div className="pp-input-icon" style={ripple > 0 ? {boxShadow: `0 0 0 ${ripple * 9}px rgba(185,252,169,${ripple * 0.16})`} : undefined}>
        <RingGlyph kind={input.kind} size={compact ? 24 : 30} />
      </div>
      <div>
        <div className="pp-input-kicker">{input.kind.toUpperCase()}</div>
        <span className="pp-input-label">{input.label}</span>
      </div>
    </div>
  );
}

export function useActiveInput(sceneId: SceneId, localFrame: number): RingInput | null {
  const inputs = sceneConfig(sceneId).inputs ?? [];
  const seconds = localFrame / FPS;
  let active: RingInput | null = null;
  for (const input of inputs) {
    if (input.at <= seconds + 0.01) active = input;
  }
  return active;
}

export function FrameHud() {
  const frame = useCurrentFrame();
  const scene = sceneAtFrame(frame);
  const index = SCENES.findIndex((item) => item.id === scene.id);
  const local = frame / FPS - scene.start;
  const closeFade = scene.id === "close" ? 1 - phase(frame, scene.start + 0.3, scene.start + 0.9) : 1;
  return (
    <div className={`pp-hud ${scene.theme === "paper" ? "pp-theme-paper" : ""}`} style={{opacity: closeFade}}>
      <div className="pp-hud-left">
        <Mark size={21} />
        <span className="pp-hud-word">PINPOINT</span>
        <span className="pp-hud-scene">
          {String(index + 1).padStart(2, "0")} / {scene.label}
        </span>
      </div>
      <div className="pp-hud-proof">
        <i />
        {scene.proof}
      </div>
      <div className="pp-hud-progress">
        {SCENES.map((item, i) => {
          const p = i < index ? 1 : i > index ? 0 : Math.max(0, Math.min(1, local / (item.end - item.start)));
          return (
            <span key={item.id}>
              <b style={{transform: `scaleX(${p})`}} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Captions() {
  const frame = useCurrentFrame();
  const seconds = frame / FPS;
  const cue = captions.find((item) => seconds >= item.start && seconds < item.end);
  if (!cue) return null;
  const opacity = Math.min(phase(frame, cue.start, cue.start + 0.16), 1 - phase(frame, cue.end - 0.16, cue.end));
  return (
    <div className="pp-caption-wrap" style={{opacity}}>
      <div className="pp-caption">{cue.text}</div>
    </div>
  );
}
