import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {Tag} from "../components/Bits";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

const POOL = [
  "$ npm run test -- --watch=false",
  "✓ 214 passed · 3 skipped · 41.2s",
  "• reading src/auth/session.ts",
  "• editing src/auth/refresh.ts (+38 −12)",
  "I'll start with step 1 and report back.",
  "Plan: stop customers getting logged out",
  "What's happening: when a customer's login",
  "expires while two tabs are open, both tabs",
  "try to renew it at the same moment.",
  "diff --git a/billing/invoice.ts b/billing/",
  "@@ -41,7 +41,9 @@ export function terms(c)",
  "-  return 'net-60';",
  "+  return c.terms ?? 'net-45';",
  "Running migration 0042_add_sessions…",
  "warning: 2 plugins lag behind (svgr, checker)",
  "Done. 3 files changed. Waiting for review.",
  "Searching 1,284 files for 'renewToken'…",
  "Itinerary draft v3 · budget under ¥10,000",
  "Subject: Rent from January: 5% increase",
  "Opened PR #218: Fix random logouts",
  "CI: build #4412 · 11 checks running",
  "> Should I upgrade to Vite 7 or stay on 6?",
];

const WINDOWS = [
  {title: "T3 Code · login-fix", x: 64, y: 120},
  {title: "Codex · billing-api", x: 676, y: 120},
  {title: "Claude Code · site", x: 1288, y: 120},
  {title: "T3 Code · family-plan", x: 64, y: 540},
  {title: "Codex · deps-upgrade", x: 676, y: 540},
  {title: "Claude Code · launch-post", x: 1288, y: 540},
];
const W = 568;
const H = 390;

function Window({title, x, y, i, local, fast}: {title: string; x: number; y: number; i: number; local: number; fast: boolean}) {
  const appear = interpolate(local, [0.3 + i * 0.75, 0.75 + i * 0.75], [0, 1], clamp);
  const speed = fast ? 11 : 3.2;
  const offset = local * speed + i * 5;
  const lines: string[] = [];
  for (let k = 0; k < 20; k += 1) lines.push(POOL[(Math.floor(offset) + k * 3 + i * 7) % POOL.length]);
  return (
    <div
      className="pf-win"
      style={{
        left: x,
        top: y,
        width: W,
        height: H,
        opacity: appear,
        transform: `translateY(${interpolate(appear, [0, 1], [26, 0])}px) scale(${interpolate(appear, [0, 1], [0.96, 1])})`,
      }}
    >
      <div className="bar">
        <i />
        <i />
        <i />
        <span style={{marginLeft: 8}}>{title}</span>
      </div>
      <div className="txt" style={{height: H - 40, transform: `translateY(${-((offset % 1) * 22.5)}px)`}}>
        {lines.join("\n")}
      </div>
    </div>
  );
}

export function Hook() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;

  const fast = local > 9.2;
  const working = Math.min(6, Math.floor((local - 0.3) / 0.75) + 1);
  const dim = interpolate(local, [9.0, 10.2], [0, 0.72], clamp);
  const toastIn = interpolate(local, [6.2, 6.7], [0, 1], clamp) * interpolate(local, [8.6, 9.1], [1, 0], clamp);
  const zoom = interpolate(local, [9.2, 15.4], [1, 1.06], clamp);

  const words = [
    {t: "Too much text.", at: 9.45},
    {t: "Too many threads.", at: 10.95},
    {t: "You miss what matters.", at: 12.4},
  ];

  return (
    <AbsoluteFill className="pf-scene">
      <div style={{position: "absolute", inset: 0, transform: `scale(${zoom})`, filter: fast ? `blur(${interpolate(local, [9.2, 10.4], [0, 2.4], clamp)}px)` : undefined}}>
        {WINDOWS.map((w, i) => (
          <Window key={w.title} {...w} i={i} local={local} fast={fast} />
        ))}
      </div>

      <div style={{position: "absolute", left: 64, top: 40, display: "flex", gap: 14, alignItems: "center", opacity: interpolate(local, [0.3, 0.9], [0, 1], clamp)}}>
        <span className="pf-tag" style={{fontSize: 17}}>
          <span className="dot" />
          {working} agents working
        </span>
        <span className="pf-tag" style={{fontSize: 17}}>12 threads · 4 projects</span>
      </div>
      <div style={{position: "absolute", right: 64, top: 40}}>
        <Tag sample>Illustration</Tag>
      </div>

      <div
        className="pf-chip is-amber"
        style={{
          left: 1500,
          top: 70,
          opacity: toastIn,
          transform: `translateX(${interpolate(toastIn, [0, 1], [60, 0])}px)`,
          fontSize: 26,
          zIndex: 5,
        }}
      >
        ⚠ login-fix needs you
      </div>

      <div style={{position: "absolute", inset: 0, background: `rgba(3,5,4,${dim})`}} />
      <div style={{position: "absolute", left: 0, right: 0, top: 250, textAlign: "center"}}>
        {words.map((w, i) => {
          const k = interpolate(local, [w.at, w.at + 0.35], [0, 1], clamp);
          const last = i === words.length - 1;
          return (
            <div
              key={w.t}
              className="pf-big"
              style={{
                opacity: k,
                transform: `translateY(${interpolate(k, [0, 1], [18, 0])}px)`,
                color: last ? "#ffc46b" : "#eef5f0",
                marginBottom: 10,
              }}
            >
              {w.t}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
