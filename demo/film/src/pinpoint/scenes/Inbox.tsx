import {useCurrentFrame} from "remotion";
import fixture from "../fixtures/inbox-morning.json";
import {Lens, SourceRenderer, easeOut, phase, sceneSource} from "../ui";

const points = fixture.deck.points.slice(1, 5);

type Draft = {
  index: number;
  sender: string;
  glance: string;
  corrected: boolean;
  delay: number;
};

const DRAFTS: Draft[] = points.map((point, i) => {
  const [head, ...tail] = point.glance.split(": ");
  const sender = ["Priya Raman", "Tomas Okafor", "Cassie Lin", "Airbnb"][i] ?? head;
  return {
    index: point.index,
    sender,
    glance: tail.length ? tail.join(": ") : point.glance,
    corrected: i === 1,
    delay: 0.5 + i * 0.9,
  };
});

export function Inbox() {
  const f = useCurrentFrame();
  const corrected = f / 30 >= 4.2;
  const noteIn = phase(f, 4.3, 4.75, easeOut);
  const sent = phase(f, 12.2, 12.7, easeOut);
  const summary = phase(f, 13.6, 14.2, easeOut);
  const enter = phase(f, 0.2, 0.7, easeOut);
  const source = sceneSource("inbox");

  if (source) {
    return (
      <div className="pp-stage pp-dark">
        <div className="pp-grain" />
        <div className="pp-vignette" />
        <Lens style={{left: 354, top: 204}} label="EVEN G2 · INBOX AGENT" meta="INBOX-MORNING · REAL CAPTURE">
          <SourceRenderer source={source} />
        </Lens>
        <div style={{position: "absolute", left: 360, top: 880, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, letterSpacing: "0.16em", color: "#8fa79b"}}>
          INBOX AGENT · inbox-morning
        </div>
      </div>
    );
  }

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div className="pp-inbox-left" style={{opacity: enter}}>
        <div className="pp-inbox-kicker">INBOX AGENT · 06:40 PASS</div>
        <div className="pp-inbox-head">
          23 unread.
          <br />
          <span>4 drafts.</span>
        </div>
        <div className="pp-inbox-note">
          One pass over the inbox. Four replies ready. You read the lines, not the essays.
        </div>
        <div className="pp-inbox-stats">
          <div className="pp-inbox-stat">
            <b>{corrected ? "3" : "4"}</b>
            passed in silence
          </div>
          <div className={`pp-inbox-stat ${corrected ? "x" : ""}`}>
            <b>{corrected ? "1" : "0"}</b>
            <span>correction · “Thursday, not Tuesday.”</span>
          </div>
        </div>
        <div className="pp-inbox-time">
          TRIAGE AGENT · 06:40
          <br />
          CLEARED IN 25 SECONDS
        </div>
      </div>

      <div className="pp-inbox-rows">
        {DRAFTS.map((draft, i) => {
          const reveal = phase(f, draft.delay, draft.delay + 0.45, easeOut);
          const flip = draft.corrected ? phase(f, 4.15, 4.45) : 0;
          const dim = corrected && !draft.corrected ? 1 - phase(f, 4.3, 4.9) * 0.45 : 1;
          return (
            <div
              key={draft.index}
              className={`pp-draft ${corrected && draft.corrected ? "corrected" : "agreed"}`}
              style={{
                opacity: reveal * dim,
                transform: `translateY(${(1 - reveal) * 12}px)`,
              }}
            >
              <div className="pp-draft-index">{String(draft.index).padStart(2, "0")}</div>
              <div>
                <div className="pp-draft-sender">{draft.sender}</div>
                <div className="pp-draft-glance">{draft.glance}</div>
              </div>
              <div className="pp-draft-mark">{draft.corrected && flip > 0.4 ? "x" : "+"}</div>
              {draft.corrected ? (
                <div
                  className="pp-draft-note"
                  style={{
                    maxHeight: noteIn * 54,
                    overflow: "hidden",
                    opacity: noteIn,
                  }}
                >
                  <b>CORRECTION</b>
                  “Thursday, not Tuesday.” Sent as a cited note.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="pp-inbox-leftover" style={{opacity: phase(f, 5.2, 5.75, easeOut)}}>
        <span>06</span>
        <span>
          TWO LEFT FOR YOU · <b>NORTHWIND, RECRUITER</b>
        </span>
      </div>

      <div
        className="pp-inbox-send"
        style={{
          opacity: 0.22 + 0.78 * phase(f, 4.3, 4.9, easeOut),
          borderColor: sent > 0 ? "rgba(185,252,169,.5)" : undefined,
        }}
      >
        <span className="lbl">SEND REVIEW</span>
        <span className="txt">{corrected ? "1 correction · 3 agreed" : "4 drafts · reading"}</span>
        <span className="right">
          <i />
          {sent > 0 ? "SENT TO AGENT" : corrected ? "TAP TO SEND" : "READING"}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          right: 100,
          top: 862,
          textAlign: "right",
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "#8aa095",
          opacity: summary,
        }}
      >
        ONE CORRECTION, CITED ON DRAFT 02
        <br />
        THREE OTHERS PASSED IN SILENCE
      </div>
    </div>
  );
}
