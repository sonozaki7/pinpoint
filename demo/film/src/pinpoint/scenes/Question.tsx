import {useCurrentFrame} from "remotion";
import {sceneConfig} from "../data";
import {GestureChip, Lens, SourceRenderer, Still, easeOut, phase, sceneSource, useActiveInput} from "../ui";

const OPTIONS = ["Stay on 6 for now", "Upgrade to 7", "Upgrade in a branch"];

export function Question() {
  const f = useCurrentFrame();
  const seconds = f / 30;
  const answered = seconds >= 5.0;
  const back = seconds >= 7.0;
  const config = sceneConfig("question");
  const source = sceneSource("question");
  const active = useActiveInput("question", f);
  const still = answered ? config.stills?.answer : config.stills?.options;
  const enter = phase(f, 0.2, 0.6, easeOut);
  const swap = phase(f, 4.95, 5.3);

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <Lens style={{left: 84, top: 168}} label="EVEN G2 · QUESTION" meta="REAL CAPTURE · 8.2 S · ONE TAP">
        {source ? <SourceRenderer source={source} /> : still ? <Still key={answered ? "answer" : "options"} src={still} /> : null}
      </Lens>

      <div className="pp-q-rail">
        <div className="pp-rail-kicker">
          <i />
          {back ? "BACK TO INBOX · deps-upgrade" : answered ? "ANSWERED · deps-upgrade" : "T3 QUESTION · deps-upgrade"}
        </div>
        <div className="pp-q-title" style={{opacity: enter}}>
          {back ? (
            <>
              Back to the<br />
              <span>inbox.</span>
            </>
          ) : answered ? (
            <>
              Stay on 6.<br />
              <span>One tap.</span>
            </>
          ) : (
            <>
              Vite 7 now,<br />
              <span>or stay on 6?</span>
            </>
          )}
        </div>

        <div className="pp-q-card" style={{opacity: back ? 0.38 : phase(f, 0.55, 1.0)}}>
          <small>{answered ? "RECORDED ANSWER · 1 OF 6" : "OPTIONS ON THE GLASSES"}</small>
          {OPTIONS.map((option, index) => {
            const picked = answered && index === 0;
            return (
              <div key={option} className={`pp-q-option ${picked ? "picked" : ""}`}>
                <b>{picked ? "=" : index + 1}</b>
                {option}
              </div>
            );
          })}
          <div className="pp-q-option" style={{opacity: 0.62}}>
            <b>·</b>
            Say something else
          </div>
        </div>

        <div className="pp-q-answer" style={{opacity: back ? 0.45 : swap}}>
          <i />
          = 1 · ANSWERED ON THE GLASSES
        </div>

        <div className="pp-rail-ticks" style={{marginTop: 26}}>
          {Array.from({length: 6}, (_, i) => (
            <i key={i} className={i === 0 && answered ? "on" : ""} />
          ))}
        </div>
        <div className="pp-rail-legend">
          <span>1 OF 6 POINTS · QUESTION</span>
          <span>NO KEYBOARD</span>
        </div>
      </div>

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
        deps-upgrade · REAL SIMULATOR CAPTURE
      </div>
    </div>
  );
}
