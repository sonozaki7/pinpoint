import {AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import fixture from "./fixtures/auth-refresh-fix.json";
import {Rich} from "./rich";
import {T3_BULLET_4, T3_BULLET_6, T3_PROOF, T3_REVIEW_HEAD, T3_REVIEW_LINES} from "./t3";
import {GestureChip, Mark, Lens, RingGlyph, easeOut, fadeEdges, ff, phase} from "./ui";
import {clampOpts} from "./ui";
import "./teaser.css";

export const TEASER_DURATION = 41;

const HOOK_END = 6.5;
const HERO_END = 23.82;
const PAYOFF_END = 34;

const wallLines = fixture.source.text.split("\n").filter((line) => line.trim().length > 0);
const WALL_COLUMNS = 4;
const wall = Array.from({length: WALL_COLUMNS}, (_, column) =>
  wallLines.filter((_, index) => index % WALL_COLUMNS === column),
);

function Hook() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const wallOut = 1 - phase(f, 4.6, 5.6);
  const titleIn = phase(f, 0.15, 0.85, easeOut);
  const trainIn = phase(f, 1.4, 2.2, easeOut);
  const rule = phase(f, 4.9, 5.8, easeOut);
  const out = 1 - phase(f, 6.1, 6.5);

  return (
    <AbsoluteFill className="pp-stage pp-dark" style={{opacity: out}}>
      <div className="pp-grain" />
      <div className="pp-vignette" />
      <div className="pp-teaser-wall" style={{opacity: 0.22 * wallOut}}>
        <div style={{display: "flex", gap: 26, width: 1180, marginLeft: -50, transform: `translateY(${-140 - seconds * 26}px)`}}>
          {wall.map((lines, column) => (
            <div key={column} className="pp-teaser-wall-col">
              {lines.map((line, index) => (
                <p key={index} style={{color: /^\s*(4\.|6\.)/.test(line) ? "#d8ffd0" : undefined}}>
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pp-teaser-brand">
        <Mark size={26} width={1.8} />
        PINPOINT
      </div>
      <div className="pp-teaser-brand-right">EVEN G2 · T3 CODE</div>

      <div style={{position: "absolute", left: 78, top: 470, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 26}px)`}}>
        <div className="pp-teaser-kicker">A 7-STEP PLAN FROM YOUR AGENT</div>
        <div className="pp-teaser-hook">
          Your agents
          <br />
          write essays.
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 78,
          top: 900,
          opacity: trainIn,
          transform: `translateY(${(1 - trainIn) * 20}px)`,
        }}
      >
        <div className="pp-teaser-train">You’re on a train.</div>
        <div className="pp-teaser-sub">Seven lines. Each one a decision.</div>
      </div>

      <div
        className="pp-teaser-rule"
        style={{left: 78, top: 1240, width: 924 * rule, opacity: rule}}
      />
      <div className="pp-teaser-foot">REAL PLAN TEXT · 510 WORDS · COLLAPSED TO 7 LINES</div>
    </AbsoluteFill>
  );
}

function Hero() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const inCount = (at: number) => phase(f, at, at + 0.45, easeOut);
  const quoteOne = fadeEdges(f, 4.4, 11.2);
  const quoteTwo = fadeEdges(f, 10.9, 17.3);
  const out = 1 - phase(f, 17.0, 17.32);

  const chips = [
    {at: 0.05, kind: "talk" as const, label: "speak the objection"},
    {at: 6.72, kind: "talk" as const, label: "speak the note"},
    {at: 14.92, kind: "tap" as const, label: "send the review"},
  ];
  const active = [...chips].reverse().find((chip) => seconds >= chip.at) ?? null;

  return (
    <AbsoluteFill className="pp-stage pp-dark" style={{opacity: out}}>
      <div className="pp-grain" />
      <div className="pp-vignette" />
      <div className="pp-teaser-brand">
        <Mark size={26} width={1.8} />
        PINPOINT
      </div>
      <div className="pp-teaser-brand-right">THE REVIEW · REAL RECORDING</div>

      <div style={{position: "absolute", left: 78, top: 210}}>
        <div className="pp-teaser-kicker">ONE THREAD · SEVEN STEPS</div>
        <div className="pp-teaser-counts">
          <div style={{opacity: 0.55}}>A seven-step plan.</div>
          <div style={{opacity: inCount(4.55)}}>1 objection.</div>
          <div style={{opacity: inCount(10.75)}}>1 note.</div>
          <div style={{opacity: inCount(11.95), color: "#b9fca9"}}>5 agreed.</div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 43,
          top: 625,
          width: 994,
          height: 522,
          transform: `scale(${0.985 + 0.015 * Math.min(1, f / 25)})`,
          transformOrigin: "50% 50%",
        }}
      >
        <div style={{transform: "scale(0.82)", transformOrigin: "top left"}}>
          <Lens style={{left: 0, top: 0}} label={null} meta={null}>
            <OffthreadVideo
              src={staticFile("clips/live-hero.mp4")}
              muted
              startFrom={Math.round(5.48 * 30)}
              style={{display: "block", width: 1152, height: 576}}
            />
          </Lens>
        </div>
      </div>

      <div style={{position: "absolute", left: 78, top: 1180, width: 930, height: 150}}>
        <div className="pp-teaser-quote" style={{opacity: quoteOne}}>
          “No. Don’t log everyone out.
          <br />
          Migrate the existing sessions instead.”
        </div>
        <div className="pp-teaser-quote" style={{opacity: quoteTwo, position: "absolute", left: 0, top: 0}}>
          “Use a request queue.
          <br />
          A mutex deadlocks with the retry path.”
        </div>
      </div>

      {active ? (
        <GestureChip
          compact
          input={{at: active.at, kind: active.kind, label: active.label}}
          localFrame={f}
          style={{left: 78, top: 1350}}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1450,
          opacity: phase(f, 15.2, 15.9, easeOut),
          font: "540 56px/1.02 var(--sans)",
          letterSpacing: "-0.05em",
          color: "#b9fca9",
        }}
      >
        Sent in one tap.
      </div>

      <div className="pp-teaser-gestures">
        <span><RingGlyph kind="swipe" size={22} /> SWIPE · move</span>
        <span><RingGlyph kind="tap" size={22} /> TAP · open</span>
        <span><RingGlyph kind="talk" size={22} /> TALK · say it</span>
      </div>

      <div className="pp-teaser-strip">
        <span>REAL SIMULATOR CAPTURE</span>
        <span>22.8 S · 30 FPS · NO EDITS</span>
      </div>
      <div className="pp-teaser-foot">EVEN G2 · 1 OBJECTION · 1 NOTE · 5 AGREED</div>
    </AbsoluteFill>
  );
}

function Payoff() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const reviewIn = phase(f, 0.2, 1.0, easeOut);
  const replyIn = phase(f, 1.5, 2.4, easeOut);
  const proofIn = phase(f, 2.9, 3.7, easeOut);
  const fromGlasses = phase(f, 4.4, 5.2, easeOut);
  const out = 1 - phase(f, 9.8, 10.18);

  return (
    <AbsoluteFill className="pp-stage pp-paper pp-dots" style={{opacity: out}}>
      <div className="pp-grain" />
      <div className="pp-vignette" />
      <div className="pp-teaser-brand" style={{color: "#1a2a31"}}>
        <Mark size={26} width={1.8} />
        PINPOINT
      </div>
      <div className="pp-teaser-brand-right" style={{color: "#5f7067"}}>T3 CODE · REAL THREAD</div>

      <div style={{position: "absolute", left: 78, top: 170, width: 924}}>
        <div className="pp-teaser-kicker" style={{color: "#6f7d72"}}>THE PAYOFF · NO ILLUSTRATION</div>
        <div className="pp-teaser-payoff-title">
          The agent replied
          <br />
          in 7 s.
        </div>
      </div>

      <div
        className="pp-teaser-card"
        style={{
          position: "absolute",
          left: 78,
          top: 500,
          width: 924,
          opacity: reviewIn,
          transform: `translateY(${(1 - reviewIn) * 20}px)`,
        }}
      >
        <div className="pp-teaser-card-head">
          <b>{T3_REVIEW_HEAD}</b>
          <span>SENT FROM EVEN G2</span>
        </div>
        {T3_REVIEW_LINES.map((line, index) => {
          const key = line.slice(0, 1);
          const text = line.slice(1).trimStart();
          return (
            <div key={index} className={`pp-teaser-review-line ${key === "✗" ? "object" : key === "✓" ? "agreed" : "note"}`}>
              <b>{key}</b>
              <span>{text}</span>
            </div>
          );
        })}
      </div>

      <div
        className="pp-teaser-card"
        style={{
          position: "absolute",
          left: 78,
          top: 940,
          width: 924,
          opacity: replyIn,
          transform: `translateY(${(1 - replyIn) * 20}px)`,
        }}
      >
        <div className="pp-teaser-card-head">
          <b>OPENCODE</b>
          <span>18:49:10 UTC · 7 S LATER</span>
        </div>
        <div className="pp-teaser-reply">
          <div><Rich text={T3_BULLET_4} /></div>
          <div style={{marginTop: 10}}><Rich text={T3_BULLET_6} /></div>
        </div>
      </div>

      <div style={{position: "absolute", left: 78, top: 1390, width: 924, opacity: proofIn}}>
        <div className="pp-teaser-proof-kicker">MEASURED · REAL RUN</div>
        <div className="pp-teaser-proof">{T3_PROOF}</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 78,
          top: 1530,
          opacity: fromGlasses,
          font: "540 54px/1.1 var(--sans)",
          letterSpacing: "-0.045em",
          color: "#22352b",
        }}
      >
        Laptop-quality feedback.
        <br />
        <span style={{color: "#3f6a45"}}>From your glasses.</span>
      </div>

      <div className="pp-teaser-foot" style={{color: "#6f7d72"}}>EXPORTED FROM demo/recordings/t3-live-thread.json</div>
    </AbsoluteFill>
  );
}

function Close() {
  const f = useCurrentFrame();
  const titleIn = phase(f, 0.1, 0.8, easeOut);
  const metaIn = phase(f, 1.3, 2.0, easeOut);
  const urlIn = phase(f, 2.3, 3.0, easeOut);
  const proofIn = phase(f, 3.4, 4.1, easeOut);

  return (
    <AbsoluteFill className="pp-stage pp-paper pp-dots">
      <div className="pp-grain" />
      <div className="pp-vignette" />
      <div className="pp-teaser-brand" style={{color: "#1a2a31"}}>
        <Mark size={26} width={1.8} />
        PINPOINT
      </div>
      <div className="pp-teaser-brand-right" style={{color: "#5f7067"}}>HEADS UP · 2026</div>

      <div style={{position: "absolute", right: 26, top: 1120, opacity: 0.05, color: "#264133"}}>
        <Mark size={520} width={0.8} />
      </div>

      <div style={{position: "absolute", left: 78, top: 500, opacity: titleIn, transform: `translateY(${(1 - titleIn) * 24}px)`}}>
        <div className="pp-teaser-close-title">
          Ring for where.
          <br />
          <span>Voice for what.</span>
        </div>
      </div>

      <div style={{position: "absolute", left: 82, top: 900, opacity: metaIn}}>
        <div className="pp-teaser-sub" style={{color: "#4f5f5b"}}>Even G2 + R1 · T3 Code · Telegram · open source</div>
      </div>

      <div style={{position: "absolute", left: 82, top: 1060, opacity: urlIn, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10}}>
        <div className="pp-teaser-url">https://pinpoint.qolso.com/</div>
        <div className="pp-teaser-url" style={{color: "#5f7067"}}>github.com/sonozaki7/pinpoint</div>
      </div>

      <div style={{position: "absolute", left: 82, top: 1290, opacity: proofIn}}>
        <div className="pp-teaser-proof-kicker">MEASURED · REAL RUN</div>
        <div className="pp-teaser-proof" style={{fontSize: 38}}>20 s review · 2 notes · 7 s reply</div>
      </div>

      <div className="pp-teaser-foot" style={{color: "#6f7d72"}}>RING FOR WHERE. VOICE FOR WHAT.</div>
    </AbsoluteFill>
  );
}

export function PinpointTeaser() {
  const f = useCurrentFrame();
  const black = Math.max(
    interpolate(f, [0, 6], [1, 0], clampOpts),
    interpolate(f, [ff(TEASER_DURATION - 0.5), ff(TEASER_DURATION) - 1], [0, 1], clampOpts),
  );
  return (
    <AbsoluteFill className="pp-root pp-teaser-root">
      <Sequence from={0} durationInFrames={ff(HOOK_END)} premountFor={12}>
        <Hook />
      </Sequence>
      <Sequence from={ff(HOOK_END)} durationInFrames={ff(HERO_END - HOOK_END)} premountFor={24}>
        <Hero />
      </Sequence>
      <Sequence from={ff(HERO_END)} durationInFrames={ff(PAYOFF_END - HERO_END)} premountFor={18}>
        <Payoff />
      </Sequence>
      <Sequence from={ff(PAYOFF_END)} durationInFrames={ff(TEASER_DURATION - PAYOFF_END)}>
        <Close />
      </Sequence>

      <Audio src={staticFile("audio/teaser-voice-kokoro.mp3")} />
      <Audio src={staticFile("audio/pinpoint-bed-v2.mp3")} volume={0.24} />
      <AbsoluteFill style={{background: "#000", opacity: black, pointerEvents: "none"}} />
    </AbsoluteFill>
  );
}
