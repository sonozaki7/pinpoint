import type {ReactNode} from "react";
import {useCurrentFrame} from "remotion";
import {sceneConfig} from "../data";
import {GestureChip, Lens, SourceRenderer, Still, easeOut, phase, sceneSource, useActiveInput} from "../ui";

type Beat = {
  id: string;
  start: number;
  end: number;
  still: string;
  kicker: string;
  title: ReactNode;
  body?: ReactNode;
  note?: {kicker: string; text: string; meta: string};
  passed: number;
  objections?: number[];
  risk?: boolean;
  ghost: string;
};

const BEATS: Beat[] = [
  {
    id: "inbox",
    start: 0,
    end: 4.5,
    still: "inbox",
    kicker: "EVEN G2 · INBOX",
    title: <>One thread<br />needs you.</>,
    body: "T3 Code stopped on a plan. The glasses list it first.",
    passed: 0,
    ghost: "07",
  },
  {
    id: "point1",
    start: 4.5,
    end: 10.5,
    still: "point1",
    kicker: "07 POINTS · SILENCE AGREES",
    title: <>Seven lines.<br />One plan.</>,
    body: "Each line is one decision, quoted word-for-word from the agent.",
    passed: 1,
    ghost: "01",
  },
  {
    id: "point4",
    start: 10.5,
    end: 16.5,
    still: "point4",
    kicker: "POINT 04 / HIGH RISK",
    title: <>This step signs<br />out everyone.</>,
    body: "A destructive migration, buried on page two.",
    passed: 3,
    risk: true,
    ghost: "04",
  },
  {
    id: "recording",
    start: 16.5,
    end: 22.5,
    still: "recording",
    kicker: "RECORDING",
    title: <>Say what’s<br />wrong.</>,
    body: "One sentence. It attaches to the point you are on.",
    passed: 3,
    risk: true,
    ghost: "04",
  },
  {
    id: "note",
    start: 22.5,
    end: 30,
    still: "note",
    kicker: "OBJECTION / CITED",
    title: <>Your words,<br />on that step.</>,
    note: {
      kicker: "TRANSCRIPT · STEP 04",
      text: "No, keep the existing sessions and migrate them instead.",
      meta: "x objection · sent with the review",
    },
    passed: 4,
    objections: [4],
    ghost: "04",
  },
  {
    id: "send",
    start: 30,
    end: 38,
    still: "send",
    kicker: "NOTE 02 / STEP 06",
    title: <>One more.</>,
    note: {
      kicker: "TRANSCRIPT · STEP 06",
      text: "Use a request queue; a mutex deadlocks with the retry path.",
      meta: "* note · cited on the exact sentence",
    },
    passed: 7,
    objections: [4, 6],
    ghost: "06",
  },
  {
    id: "preview",
    start: 38,
    end: 45,
    still: "preview",
    kicker: "PREVIEW · ONE TAP",
    title: <>Nothing else<br />to say.</>,
    body: "The points you didn’t stop on pass in silence.",
    passed: 7,
    objections: [4, 6],
    ghost: "07",
  },
  {
    id: "sent",
    start: 45,
    end: 53,
    still: "sent",
    kicker: "SENT / T3 CODE",
    title: <>Back to<br />the agent.</>,
    body: "The review lands as a normal message in the thread.",
    passed: 7,
    objections: [4, 6],
    ghost: "07",
  },
  {
    id: "inboxAfter",
    start: 53,
    end: 60,
    still: "inboxAfter",
    kicker: "INBOX / CLEARED",
    title: <>Back to<br />the train.</>,
    body: "The next thread can wait.",
    passed: 7,
    objections: [4, 6],
    ghost: "07",
  },
];

function Rail({beat, frame}: {beat: Beat; frame: number}) {
  const local = frame / 30;
  if (local < beat.start - 0.01 || local >= beat.end + 0.01) return null;
  const enter = phase(frame, beat.start, beat.start + 0.42, easeOut);
  const agree = beat.passed - (beat.objections?.length ?? 0);
  return (
    <div className="pp-rail" style={{opacity: enter, transform: `translateY(${(1 - enter) * 10}px)`}}>
      <div className="pp-rail-kicker">
        <i />
        {beat.kicker}
      </div>
      <div className="pp-rail-title">{beat.title}</div>
      {beat.body ? <div className="pp-rail-body">{beat.body}</div> : null}
      {beat.note ? (
        <div className="pp-rail-note">
          <div className="pp-rail-note-kicker">{beat.note.kicker}</div>
          <div className="pp-rail-note-text">“{beat.note.text}”</div>
          <div className="pp-rail-note-meta">{beat.note.meta}</div>
        </div>
      ) : null}
      <div className="pp-rail-ticks">
        {Array.from({length: 7}, (_, i) => {
          const point = i + 1;
          const isObjection = (beat.objections ?? []).includes(point);
          const isPassed = point <= beat.passed;
          return <i key={point} className={isObjection ? "x" : isPassed ? "on" : ""} />;
        })}
      </div>
      <div className="pp-rail-legend">
        <span>
          {agree} AGREED · {(beat.objections ?? []).length} CITED
        </span>
        <span>1 — 7</span>
      </div>
      <div className="pp-rail-ghost">{beat.ghost}</div>
    </div>
  );
}

export function Hero() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const config = sceneConfig("hero");
  const source = sceneSource("hero");
  const active = useActiveInput("hero", f);
  const beat = BEATS.find((item) => seconds >= item.start && seconds < item.end) ?? BEATS[0];
  const still = config.stills?.[beat.still];
  const flash = 1 - phase(f, beat.start, beat.start + 0.22, easeOut);

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <Lens
        style={{left: 84, top: 168}}
        label="EVEN G2 · REVIEW"
        meta="TAP: TALK · 2×: BACK"
      >
        {source ? (
          <SourceRenderer source={source} />
        ) : still ? (
          <Still key={beat.id} src={still} flash={flash * 0.1} />
        ) : null}
      </Lens>

      <div className="pp-flash" style={{opacity: flash * 0.55}} />
      <Rail beat={beat} frame={f} />

      {active ? <GestureChip input={active} localFrame={f} style={{left: 84, top: 826}} /> : null}

      <div
        style={{
          position: "absolute",
          left: 1358,
          top: 902,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.13em",
          color: "#6c8176",
          opacity: 0.8,
        }}
      >
        auth-refresh-fix · T3 CODE · PLAN
      </div>
    </div>
  );
}
