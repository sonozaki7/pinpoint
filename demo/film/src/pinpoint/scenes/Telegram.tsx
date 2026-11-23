import {useCurrentFrame} from "remotion";
import {Mark, SourceRenderer, easeOut, phase, sceneSource} from "../ui";

const CHIPS = [
  {key: "01", text: "One private group · one topic per thread"},
  {key: "02", text: "Your notes quote-reply the exact sentence"},
  {key: "03", text: "“Read on phone” returns to step 4"},
];

export function Telegram() {
  const f = useCurrentFrame();
  const head = phase(f, 0.2, 0.8, easeOut);
  const message1 = phase(f, 0.6, 1.05, easeOut);
  const message2 = phase(f, 2.2, 2.7, easeOut);
  const quote1 = phase(f, 4.8, 5.3, easeOut);
  const quote2 = phase(f, 7.5, 8.0, easeOut);
  const readLink = phase(f, 10.2, 10.7, easeOut);
  const flash = (at: number) => 1 - phase(f, at, at + 0.7);
  const source = sceneSource("telegram");

  if (source) {
    return (
      <div className="pp-stage pp-dark">
        <div className="pp-grain" />
        <SourceRenderer source={source} width={1920} height={1080} fit="contain" />
      </div>
    );
  }

  return (
    <div className="pp-stage pp-dark">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div className="pp-phone pp-tg-phone" style={{opacity: head, transform: `translateY(${(1 - head) * 20}px)`}}>
        <div className="pp-phone-screen">
          <div className="pp-tg">
            <div className="pp-tg-header">
              <div className="pp-tg-back">‹</div>
              <div>
                <div className="pp-tg-title">Pinpoint Desk</div>
                <div className="pp-tg-sub">auth-refresh-fix · 7 points · bot</div>
              </div>
              <div className="pp-tg-dots">⋯</div>
            </div>

            <div className="pp-tg-body">
              <div className="pp-tg-msg bot" style={{opacity: message1, transform: `translateY(${(1 - message1) * 12}px)`}}>
                <div className="pp-tg-meta">
                  <b>PINPOINT</b>
                  <span>07:58</span>
                </div>
                <div className="pp-tg-text">
                  <b>Needs you · plan · 7 points</b>
                  <br />
                  Plan: stop the “logged out mid-edit” 401s
                </div>
                <div className="pp-tg-pre">{`4. Force-logout every user by truncating
   the sessions table
6. Wrap refreshToken() in a mutex`}</div>
                <div className="pp-tg-btn">AGREE ALL &amp; CONTINUE</div>
              </div>

              <div
                className="pp-tg-msg review"
                style={{opacity: message2, transform: `translateY(${(1 - message2) * 12}px)`}}
              >
                <div className="pp-tg-meta">
                  <b>PINPOINT</b>
                  <span>08:11</span>
                </div>
                <div className="pp-tg-text">
                  <b>Review from G2 (Pinpoint) — 7 points</b>
                  <br />
                  1 objection · 1 note · 5 agreed · sent to the agent
                </div>
                <div
                  className="pp-tg-btn"
                  style={{
                    borderColor: readLink > 0 ? "rgba(185,252,169,.9)" : undefined,
                    background: readLink > 0 ? "rgba(185,252,169,.1)" : undefined,
                  }}
                >
                  READ ON PHONE → STEP 4
                </div>
              </div>

              <div
                className="pp-tg-msg quote"
                style={{
                  opacity: quote1,
                  transform: `translateY(${(1 - quote1) * 14}px)`,
                  boxShadow: flash(4.8) > 0 ? `0 0 0 ${flash(4.8) * 3}px rgba(185,252,169,.16)` : undefined,
                }}
              >
                <div className="pp-tg-meta">
                  <b>PINPOINT</b>
                  <span>08:11</span>
                </div>
                <div className="pp-tg-quote-src">“Force-logout every user by truncating the sessions table”</div>
                <div className="pp-tg-replytext">No. Don't log everyone out. Migrate the existing sessions instead.</div>
              </div>

              <div
                className="pp-tg-msg quote"
                style={{
                  opacity: quote2,
                  transform: `translateY(${(1 - quote2) * 14}px)`,
                  boxShadow: flash(7.5) > 0 ? `0 0 0 ${flash(7.5) * 3}px rgba(185,252,169,.16)` : undefined,
                }}
              >
                <div className="pp-tg-meta">
                  <b>PINPOINT</b>
                  <span>08:12</span>
                </div>
                <div className="pp-tg-quote-src">“Wrap refreshToken() in a mutex.”</div>
                <div className="pp-tg-replytext">Use a request queue. A mutex deadlocks with the retry path.</div>
              </div>
            </div>

            <div className="pp-tg-input">
              <i>Message</i>
              <span style={{color: "#b9fca9"}}>●</span>
            </div>
          </div>
          <div className="pp-phone-notch" />
        </div>
      </div>

      <div className="pp-tg-rail">
        <div className="pp-rail-kicker">
          <i />
          TELEGRAM · PINPOINT DESK
        </div>
        <div className="pp-tg-headline">
          Every note sits
          <br />
          on its <em>exact sentence.</em>
        </div>
        <div className="pp-tg-proof">
          <i />
          THE FULL PLAN, WHERE IT FITS
        </div>
        <div className="pp-tg-chips">
          {CHIPS.map((chip, index) => (
            <div key={chip.key} className="pp-tg-chip" style={{opacity: phase(f, 1.2 + index * 0.8, 1.7 + index * 0.8)}}>
              <b>{chip.key}</b>
              {chip.text}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 11,
            letterSpacing: "0.1em",
            color: "#8ba093",
            opacity: phase(f, 9.4, 10.2),
          }}
        >
          <span style={{width: 34, height: 1, background: "#b9fca9"}} />
          ALERTS WHILE THE APP IS CLOSED
        </div>
      </div>

      <div className="pp-tg-disclosure">ILLUSTRATIVE TELEGRAM UI · REAL BOT CAPTURE PENDING</div>

      <div
        style={{
          position: "absolute",
          left: 760,
          top: 920,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          color: "#7c9184",
          opacity: phase(f, 5.4, 6.2),
        }}
      >
        <Mark size={16} />
        QUOTE-REPLY × 2 · TOPIC auth-refresh-fix
      </div>
    </div>
  );
}
