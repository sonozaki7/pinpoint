import {useCurrentFrame} from "remotion";
import {GestureChip, Lens, SourceRenderer, easeOut, phase, sceneSource, useActiveInput} from "../ui";

export function Inbox() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const corrected = seconds >= 10.9;
  const noteIn = phase(f, 10.9, 11.35, easeOut);
  const enter = phase(f, 0.2, 0.7, easeOut);
  const source = sceneSource("inbox");
  const active = useActiveInput("inbox", f);

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
            <span>correction · “Make it Thursday, not Tuesday.”</span>
          </div>
        </div>
        <div className="pp-inbox-time">
          TRIAGE AGENT · 06:40
          <br />
          4 DRAFTS IN 25 SECONDS
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 840,
          top: 196,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.16em",
          color: "#7f9588",
          opacity: enter,
        }}
      >
        EVEN G2 · INBOX-MORNING · REAL CAPTURE
      </div>

      <div
        style={{
          position: "absolute",
          left: 840,
          top: 230,
          width: 800,
          height: 420,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 16}px)`,
        }}
      >
        <div style={{transform: "scale(0.66)", transformOrigin: "top left"}}>
          <Lens style={{left: 0, top: 0}} label={null} meta={null}>
            {source ? <SourceRenderer source={source} /> : null}
          </Lens>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 844,
          top: 666,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.13em",
          color: "#7f9588",
          opacity: enter,
        }}
      >
        <span style={{width: 6, height: 6, borderRadius: "50%", background: "#b9fca9"}} />
        16.1 S · 4 DRAFTS · 1 NOTE · 3 AGREED
      </div>

      <div className="pp-inbox-send" style={{left: 100, right: 1020, top: 790, opacity: 0.55 + 0.45 * phase(f, 13.8, 14.4, easeOut)}}>
        <span className="lbl">SEND REVIEW</span>
        <span className="txt">{corrected ? "1 correction · 3 agreed" : "4 drafts · reading"}</span>
        <span className="right">
          <i />
          {corrected ? "READY TO SEND" : "READING"}
        </span>
      </div>

      {active ? <GestureChip compact input={active} localFrame={f} style={{left: 100, top: 880}} /> : null}
    </div>
  );
}
