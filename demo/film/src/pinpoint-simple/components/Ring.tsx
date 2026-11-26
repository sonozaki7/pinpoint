import type {CSSProperties} from "react";

type Mode = "scroll" | "tap" | "double" | "idle";

/**
 * Line-art smart ring. No brand assets: two concentric circles with a tiny
 * sensor notch. Gestures are drawn with simple arcs and pulses.
 */
export function Ring({local, mode, size = 190, style}: {local: number; mode: Mode; size?: number; style?: CSSProperties}) {
  const cycle = (period: number) => (local % period) / period;
  const scrollAngle = cycle(2.2) * 300;
  const pulse = (offset: number) => {
    const t = (local - offset) % 1.6;
    if (local < offset || t < 0) return null;
    const k = t / 1.6;
    if (k > 1) return null;
    return {r: 52 + k * 40, o: (1 - k) * 0.75};
  };
  const p1 = mode === "tap" ? pulse(0.1) : mode === "double" ? pulse(0.1) : null;
  const p2 = mode === "double" ? pulse(0.45) : null;

  return (
    <svg
      className="ps-gesture"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={style}
      aria-hidden
    >
      <defs>
        <filter id="ring-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#ring-glow)" fill="none" stroke="#3dff8a" strokeLinecap="round">
        <circle cx="100" cy="100" r="58" strokeWidth="8" opacity="0.9" />
        <circle cx="100" cy="100" r="44" strokeWidth="4" opacity="0.45" />
        <path d="M100 30v-9M100 179v-9" strokeWidth="4" opacity="0.35" />
        {mode === "scroll" ? (
          <g transform={`rotate(${scrollAngle} 100 100)`}>
            <path d="M100 16a84 84 0 0 1 73 42" strokeWidth="5" />
            <path d="M173 42l1 19-17-9" strokeWidth="5" strokeLinejoin="round" />
          </g>
        ) : null}
        {p1 ? <circle cx="100" cy="100" r={p1.r} strokeWidth="3" opacity={p1.o} /> : null}
        {p2 ? <circle cx="100" cy="100" r={p2.r} strokeWidth="3" opacity={p2.o} /> : null}
        {mode === "tap" ? <circle cx="100" cy="100" r="10" fill="#3dff8a" stroke="none" opacity="0.85" /> : null}
        {mode === "double" ? (
          <>
            <circle cx="100" cy="100" r="9" fill="#3dff8a" stroke="none" opacity="0.75" />
            <circle cx="100" cy="100" r="16" strokeWidth="3" opacity="0.5" />
          </>
        ) : null}
      </g>
    </svg>
  );
}
