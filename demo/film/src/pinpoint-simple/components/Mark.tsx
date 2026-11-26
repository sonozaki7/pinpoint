import {interpolate, useCurrentFrame} from "remotion";

/**
 * Pinpoint mark, drawn from the project's own favicon geometry (apps/site/
 * favicon.svg): a ring, four crosshair ticks, and a centre dot. No third-party
 * brand asset. `draw` animates the ring stroke on over the first 24 frames.
 */
export function Mark({size = 160, draw = false}: {size?: number; draw?: boolean}) {
  const frame = useCurrentFrame();
  const k = draw ? interpolate(frame, [0, 24], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) : 0;
  return (
    <svg
      className="ps-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{filter: "drop-shadow(0 0 16px rgba(61,255,138,.28))"}}
      aria-hidden
    >
      <circle
        cx="32"
        cy="32"
        r="13"
        fill="none"
        stroke="#3dff8a"
        strokeWidth="2"
        strokeDasharray="82"
        strokeDashoffset={draw ? 82 * k : 0}
      />
      <path
        d="M32 10v9M32 45v9M10 32h9M45 32h9"
        stroke="#3dff8a"
        strokeWidth="2"
        opacity={draw ? 1 - k * 0.7 : 1}
      />
      <circle cx="32" cy="32" r="3.6" fill="#3dff8a" opacity={draw ? 1 - k : 1} />
    </svg>
  );
}
