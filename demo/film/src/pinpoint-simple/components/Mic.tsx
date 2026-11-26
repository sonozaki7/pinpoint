/** Line-art microphone with three short sound waves, used while talking. */
export function Mic({local}: {local: number}) {
  const level = 0.55 + 0.45 * Math.abs(Math.sin(local * 5.2));
  return (
    <svg className="ps-mic" viewBox="0 0 96 140" width="96" height="140" aria-hidden>
      <g fill="none" stroke="#3dff8a" strokeWidth="4" strokeLinecap="round">
        <rect x="33" y="10" width="30" height="62" rx="15" opacity="0.95" />
        <path d="M22 58v8a26 26 0 0 0 52 0v-8" opacity="0.8" />
        <path d="M48 92v22M34 120h28" opacity="0.8" />
        <path d="M74 44v26" opacity={0.25 + 0.55 * level} />
        <path d="M83 36v42" opacity={0.2 + 0.5 * level} />
        <path d="M92 28v58" opacity={0.15 + 0.45 * level} />
      </g>
    </svg>
  );
}
