import type {ReactNode} from "react";
import {Sequence, useCurrentFrame} from "remotion";
import {sceneConfig} from "../data";
import {GestureChip, Lens, SourceRenderer, easeOut, ff, phase, sceneSource, useActiveInput} from "../ui";

type Beat = {
  id: string;
  start: number;
  end: number;
  kicker: string;
  title: ReactNode;
  body?: ReactNode;
  note?: {kicker: string; text: string; meta: string};
  passed: number;
  objections?: number[];
  notes?: number[];
  risk?: boolean;
  ghost: string;
};

// Beat boundaries are the real timeline marks, in seconds from the first clip
// frame: deck 1.46, point 4 5.48, objection 10.09, point 6 12.19, note 16.80,
// send row 18.80, preview 20.40, sent 22.01, then the cleared inbox.
const BEATS: Beat[] = [
  {
    id: "inbox",
    start: 0,
    end: 1.4,
    kicker: "EVEN G2 · INBOX",
    title: <>Three threads.<br />One waiting.</>,
    body: "T3 Code stopped on a seven-step plan.",
    passed: 0,
    ghost: "00",
  },
  {
    id: "plan",
    start: 1.4,
    end: 3.9,
    kicker: "07 POINTS · SILENCE AGREES",
    title: <>Seven lines.<br />One plan.</>,
    body: "Each line is one decision, quoted from the plan.",
    passed: 1,
    ghost: "01",
  },
  {
    id: "point4",
    start: 3.9,
    end: 5.5,
    kicker: "POINT 04 / HIGH RISK",
    title: <>This step signs<br />out everyone.</>,
    body: "A destructive migration, buried on page two.",
    passed: 3,
    risk: true,
    ghost: "04",
  },
  {
    id: "recording",
    start: 5.5,
    end: 10.1,
    kicker: "RECORDING · POINT 04",
    title: <>Say what’s<br />wrong.</>,
    body: "One sentence. It attaches to the point you are on.",
    passed: 3,
    risk: true,
    ghost: "04",
  },
  {
    id: "objection",
    start: 10.1,
    end: 12.2,
    kicker: "OBJECTION / CITED",
    title: <>Your words,<br />on that step.</>,
    note: {
      kicker: "TRANSCRIPT · STEP 04",
      text: "No. Don't log everyone out. Migrate the existing sessions instead.",
      meta: "x objection · cited on the exact sentence",
    },
    passed: 4,
    objections: [4],
    ghost: "04",
  },
  {
    id: "noteRecording",
    start: 12.2,
    end: 16.8,
    kicker: "RECORDING · POINT 06",
    title: <>One more.</>,
    body: "A mutex that deadlocks with the retry path.",
    passed: 5,
    objections: [4],
    ghost: "06",
  },
  {
    id: "note",
    start: 16.8,
    end: 18.8,
    kicker: "NOTE / CITED",
    title: <>Cited on the<br />exact sentence.</>,
    note: {
      kicker: "TRANSCRIPT · STEP 06",
      text: "Use a request queue. A mutex deadlocks with the retry path.",
      meta: "* note · cited on the exact sentence",
    },
    passed: 6,
    objections: [4],
    notes: [6],
    ghost: "06",
  },
  {
    id: "sendRow",
    start: 18.8,
    end: 20.6,
    kicker: "SEND ROW · 2 NOTES",
    title: <>Nothing else<br />to say.</>,
    body: "Five points pass in silence.",
    passed: 7,
    objections: [4],
    notes: [6],
    ghost: "07",
  },
  {
    id: "sent",
    start: 20.6,
    end: 23.5,
    kicker: "SENT / T3 CODE",
    title: <>Back to<br />the agent.</>,
    body: "The review lands as a normal message in the thread.",
    passed: 7,
    objections: [4],
    notes: [6],
    ghost: "07",
  },
  {
    id: "cleared",
    start: 23.5,
    end: 27,
    kicker: "INBOX / CLEARED",
    title: <>Back to<br />the train.</>,
    body: "The thread is gone from the glasses inbox.",
    passed: 7,
    objections: [4],
    notes: [6],
    ghost: "07",
  },
];

function Rail({beat, frame}: {beat: Beat; frame: number}) {
  const local = frame / 30;
  if (local < beat.start - 0.01 || local >= beat.end + 0.01) return null;
  const enter = phase(frame, beat.start, beat.start + 0.42, easeOut);
  const objections = beat.objections ?? [];
  const notes = beat.notes ?? [];
  const agree = beat.passed - objections.length - notes.length;
  const legend =
    beat.passed === 7
      ? "5 AGREED · 1 OBJECTION · 1 NOTE"
      : notes.length
        ? `${agree} AGREED · 1 OBJECTION · 1 NOTE`
        : objections.length
          ? `${agree} AGREED · 1 OBJECTION`
          : `${beat.passed} OF 7 READ`;

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
          const isObjection = objections.includes(point);
          const isNote = notes.includes(point);
          const isRisk = beat.risk && point === 4 && !isObjection;
          const isPassed = point <= beat.passed && !isObjection && !isNote;
          return <i key={point} className={isObjection ? "x" : isNote ? "n" : isPassed ? "on" : isRisk ? "risk" : ""} />;
        })}
      </div>
      <div className="pp-rail-legend">
        <span>{legend}</span>
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
  const after = config.sourceAfter ?? null;
  const afterAt = config.afterAt ?? 22.0;
  const active = useActiveInput("hero", f);
  const beat = BEATS.find((item) => seconds >= item.start && seconds < item.end) ?? BEATS[0];

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <Lens style={{left: 84, top: 168}} label="EVEN G2 · LIVE REVIEW" meta="REAL CAPTURES · 22.8 S + 1.9 S">
        {source ? (
          <>
            <Sequence durationInFrames={ff(afterAt)} premountFor={24}>
              <SourceRenderer source={source} />
            </Sequence>
            {after ? (
              <Sequence from={ff(afterAt)} premountFor={30}>
                <SourceRenderer source={after} />
              </Sequence>
            ) : null}
          </>
        ) : null}
      </Lens>

      <Rail beat={beat} frame={f} />

      {active && !(seconds >= afterAt && active.at < afterAt) ? (
        <GestureChip input={active} localFrame={f} style={{left: 84, top: 826}} />
      ) : null}

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
        auth-refresh-fix · T3 CODE · LIVE RUN
      </div>
    </div>
  );
}
