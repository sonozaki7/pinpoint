import {useCurrentFrame} from "remotion";
import fixture from "../fixtures/auth-refresh-fix.json";
import {Mark, easeInOut, easeOut, phase} from "../ui";

const points = fixture.deck.points.slice(0, 7);

function Underline({draw}: {draw: number}) {
  return (
    <svg viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M3 8.5C52 3.5 142 2.5 217 6.5"
        fill="none"
        stroke="#4f7a52"
        strokeWidth="4"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - draw}
      />
    </svg>
  );
}

export function Close() {
  const f = useCurrentFrame();
  const converge = phase(f, 0.35, 0.95, easeInOut);
  const paperIn = phase(f, 1.0, 1.55);
  const darkOut = 1 - phase(f, 1.1, 1.6);
  const titleIn = phase(f, 1.35, 1.95, easeOut);
  const line1 = phase(f, 2.0, 2.7, easeInOut);
  const line2 = phase(f, 2.6, 3.3, easeInOut);
  const metaIn = phase(f, 3.4, 4.0);
  const urlIn = phase(f, 4.3, 4.9);
  const finalIn = phase(f, 5.6, 6.2);

  return (
    <div className="pp-stage pp-close">
      <div className="pp-close-dark" style={{opacity: darkOut}}>
        <div className="pp-dark" style={{position: "absolute", inset: 0}} />
        <div className="pp-grain" />
        <div style={{position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", opacity: 0.16}}>
          <Mark size={420} width={0.9} />
        </div>
        <div
          className="pp-close-points"
          style={{opacity: phase(f, 0.05, 0.35) * (1 - converge), transform: `translate(-50%,-50%) scale(${1 - converge * 0.96})`}}
        >
          {points.map((point) => (
            <div key={point.id} className="pp-close-point">
              <b>{point.kind === "risk" ? "!" : "o"}</b>
              <span>{point.glance}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pp-close-paper pp-paper pp-dots" style={{opacity: paperIn}}>
        <div className="pp-grain" />
        <div className="pp-vignette" />
        <div style={{position: "absolute", right: 96, top: 250, opacity: 0.08, color: "#264133"}}>
          <Mark size={460} width={0.8} />
        </div>
        <div className="pp-close-brand" style={{opacity: phase(f, 1.5, 2.1)}}>
          <Mark size={30} width={1.5} />
          PINPOINT
        </div>

        <div className="pp-close-title" style={{opacity: titleIn, transform: `translateY(${(1 - titleIn) * 16}px)`}}>
          <h1>
            Ring for{" "}
            <span>
              where
              <Underline draw={line1} />
            </span>
            .
          </h1>
          <h1>
            Voice for{" "}
            <span>
              what
              <Underline draw={line2} />
            </span>
            .
          </h1>
        </div>

        <div className="pp-close-meta" style={{opacity: metaIn}}>
          <i />
          Even G2 + R1 · T3 Code · Telegram · open source
        </div>

        <div className="pp-close-urls" style={{opacity: urlIn}}>
          <div className="pp-close-url">
            <small>SITE</small>
            <span>https://sonozaki7.github.io/pinpoint/</span>
          </div>
          <div className="pp-close-url">
            <small>SOURCE</small>
            <span>github.com/sonozaki7/pinpoint</span>
          </div>
        </div>

        <div className="pp-close-final" style={{opacity: finalIn}}>
          <i />
          HEADS UP · 2026
        </div>

      </div>
    </div>
  );
}
