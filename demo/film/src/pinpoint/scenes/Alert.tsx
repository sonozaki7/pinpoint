import {useCurrentFrame} from "remotion";
import {sceneConfig} from "../data";
import {Lens, Mark, SourceRenderer, Still, easeOut, phase, sceneSource} from "../ui";

export function Alert() {
  const f = useCurrentFrame();
  const phoneIn = phase(f, 0.15, 0.85);
  const notif = phase(f, 0.75, 1.25, easeOut);
  const lensIn = phase(f, 1.65, 2.45, easeOut);
  const mirror = phase(f, 2.55, 3.25);
  const config = sceneConfig("alert");
  const source = sceneSource("alert");
  const still = config.stills?.inbox;

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div
        className="pp-phone"
        style={{
          left: 140,
          top: 210,
          width: 340,
          height: 720,
          opacity: phoneIn * (0.78 + 0.22 * (1 - lensIn)),
          transform: `translateY(${(1 - phoneIn) * 24}px) scale(${1 - lensIn * 0.012})`,
        }}
      >
        <div className="pp-phone-label">PHONE · LOCKED</div>
        <div className="pp-phone-screen">
          <div className="pp-lock">
            <div className="pp-lock-time">08:12</div>
            <div className="pp-lock-date">TUESDAY · 24 NOVEMBER</div>
            <div
              className="pp-notif"
              style={{opacity: notif, transform: `translateY(${(1 - notif) * -18}px)`}}
            >
              <div className="pp-notif-head">
                <span className="pp-notif-icon">
                  <Mark size={14} width={2} />
                </span>
                <span>PINPOINT DESK</span>
                <span>now</span>
              </div>
              <div className="pp-notif-title">auth-refresh-fix needs you</div>
              <div className="pp-notif-body">plan · 7 steps · T3 Code</div>
              <div className="pp-notif-foot">OPEN ON GLASSES ›</div>
            </div>
            <div className="pp-lock-minor">
              <div className="pp-notif minor">
                <div className="pp-notif-head">
                  <span className="pp-notif-icon small"><Mark size={11} width={2} /></span>
                  <span>PINPOINT DESK</span>
                  <span>2m</span>
                </div>
                <div className="pp-notif-minor-title">deps-upgrade · question</div>
                <div className="pp-notif-minor-body">Upgrade to Vite 7 now or stay on 6?</div>
              </div>
              <div className="pp-notif minor" style={{opacity: 0.62}}>
                <div className="pp-notif-head">
                  <span className="pp-notif-icon small"><Mark size={11} width={2} /></span>
                  <span>PINPOINT DESK</span>
                  <span>9m</span>
                </div>
                <div className="pp-notif-minor-title">inbox-morning · report</div>
                <div className="pp-notif-minor-body">4 drafts ready for review</div>
              </div>
            </div>
            <div className="pp-lock-hint">SWIPE UP TO OPEN</div>
          </div>
          <div className="pp-phone-notch" />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 498,
          top: 548,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          alignItems: "center",
          opacity: mirror,
        }}
      >
        <div style={{fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.2em", color: "#a6e9a4"}}>
          MIRROR
        </div>
        {[0, 1, 2].map((i) => (
          <svg key={i} width="26" height="14" viewBox="0 0 26 14" fill="none" style={{opacity: 0.25 + i * 0.32}}>
            <path d="M2 2l8 5-8 5M14 2l8 5-8 5" stroke="#b9fca9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: lensIn,
          transform: `translateY(${(1 - lensIn) * 18}px)`,
        }}
      >
        <Lens style={{left: 590, top: 246}} label="EVEN G2 · ALERT" meta="PHONE NOTIFICATION · MIRRORED">
          {source ? (
            <SourceRenderer source={source} />
          ) : still ? (
            <Still src={still} />
          ) : null}
        </Lens>
      </div>

      <div
        style={{
          position: "absolute",
          left: 596,
          top: 930,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.16em",
          color: "#8aa095",
          opacity: phase(f, 3.1, 3.8),
        }}
      >
        <span style={{width: 6, height: 6, borderRadius: "50%", background: "#b9fca9"}} />
        PINPOINT DESK · ONE TOPIC PER THREAD
      </div>
    </div>
  );
}
