import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Lens, MicIcon, Photo, RingIcon, Tag} from "../components/Bits";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
const ff = (seconds: number) => Math.round(seconds * 30);

export type Seg = {at: number; dur: number; src?: string; still?: string; from?: number; rate?: number};
export type Rail = {at: number; dur: number; label: string; sub?: string; mode: "scroll" | "tap" | "talk" | "idle"};
export type Overlay =
  | {kind: "reply"; at: number; dur: number; who: string; tag: string; sample?: boolean; body: React.ReactNode; meta?: string}
  | {kind: "chip"; at: number; dur: number; text: string; x: number; y: number; tone?: "green" | "amber" | "red"; size?: number}
  | {kind: "menu"; at: number; dur: number; items: string[]; pick: number; note?: string};
export type PhotoCut = {at: number; src: string; push?: number; pan?: number};

export type FootageSceneProps = {
  label: string;
  photos: PhotoCut[];
  segs: Seg[];
  rail: Rail[];
  overlays: Overlay[];
  tags: {text: string; sample?: boolean}[];
  duration: number;
};

export function FootageScene({label, photos, segs, rail, overlays, tags, duration}: FootageSceneProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;

  const activeRail = rail.find((r) => local >= r.at && local < r.at + r.dur) ?? null;

  return (
    <AbsoluteFill className="pf-scene">
      {photos.map((p, i) => {
        const end = photos[i + 1]?.at ?? duration;
        return (
          <Sequence key={p.src} from={ff(p.at)} durationInFrames={ff(end - p.at) + 12} premountFor={20}>
            <Photo src={p.src} push={p.push} pan={p.pan} />
          </Sequence>
        );
      })}

      <div className="pf-topbar">
        <span className="scene">{label}</span>
        <span style={{flex: 1}} />
        {tags.map((t) => (
          <Tag key={t.text} sample={t.sample}>
            {t.text}
          </Tag>
        ))}
      </div>

      {segs.map((s, i) => (
        <Sequence key={i} from={ff(s.at)} durationInFrames={ff(s.dur)} premountFor={20}>
          <Lens src={s.src} still={s.still} startFrom={s.from ?? 0} playbackRate={s.rate ?? 1} />
        </Sequence>
      ))}

      {activeRail ? (
        <div className="pf-rail">
          {activeRail.mode === "talk" ? <MicIcon local={local - activeRail.at} /> : <RingIcon local={local - activeRail.at} mode={activeRail.mode} />}
          <div className="pf-rail-label">{activeRail.label}</div>
          {activeRail.sub ? <div className="pf-rail-sub">{activeRail.sub}</div> : null}
        </div>
      ) : null}

      {overlays.map((o, i) => {
        const k = interpolate(local, [o.at, o.at + 0.35, o.at + o.dur - 0.35, o.at + o.dur], [0, 1, 1, 0], clamp);
        if (k <= 0) return null;
        if (o.kind === "menu") {
          const pickAt = o.at + 0.9;
          return (
            <div key={i} className="pf-menu" style={{opacity: k, transform: `translateX(${interpolate(k, [0, 1], [24, 0])}px)`}}>
              <div className="pf-menu-title">Hold the ring</div>
              {o.items.map((item, n) => (
                <div key={item} className={`pf-menu-item${n === o.pick && local >= pickAt ? " is-pick" : ""}`}>
                  {item}
                </div>
              ))}
              {o.note ? <div className="pf-menu-note">{o.note}</div> : null}
            </div>
          );
        }
        if (o.kind === "chip") {
          return (
            <div
              key={i}
              className={`pf-chip${o.tone === "amber" ? " is-amber" : o.tone === "red" ? " is-red" : ""}`}
              style={{left: o.x, top: o.y, opacity: k, fontSize: o.size ?? 30, transform: `translateY(${interpolate(k, [0, 1], [10, 0])}px)`}}
            >
              {o.text}
            </div>
          );
        }
        return (
          <div key={i} className="pf-reply" style={{opacity: k, transform: `translateY(${interpolate(k, [0, 1], [18, 0])}px)`}}>
            <div className="who">
              <Tag sample={o.sample}>{o.tag}</Tag>
              <span style={{fontSize: 22, fontWeight: 650, color: "#eef5f0"}}>{o.who}</span>
            </div>
            <div className="body">{o.body}</div>
            {o.meta ? <div className="meta">{o.meta}</div> : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
