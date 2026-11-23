import {useCurrentFrame} from "remotion";
import {Mark, SourceRenderer, easeOut, phase, sceneSource} from "../ui";

const SIDEBAR = [
  {id: "auth-refresh-fix", sub: "Codex · needs you", need: true, active: true},
  {id: "deps-upgrade", sub: "Claude Code · question", need: true},
  {id: "inbox-morning", sub: "inbox agent · report", need: true},
  {id: "flaky-e2e", sub: "run failed", need: false},
];

const REVIEW: {key: string; cls: string; quote: string; arrow: string; plain?: boolean}[] = [
  {
    key: "✗",
    cls: "object",
    quote: "Force-logout every user by truncating the sessions table",
    arrow: "No. Migrate existing sessions instead.",
  },
  {
    key: "✗",
    cls: "object",
    quote: "Wrap refreshToken() in a mutex",
    arrow: "Use a request queue; a mutex deadlocks with the retry path.",
  },
  {
    key: "✓",
    cls: "agreed",
    quote: "Agreed: 1, 2, 3, 5, 7.",
    arrow: "Go ahead with the rest of the plan.",
    plain: true,
  },
];

export function Payoff() {
  const f = useCurrentFrame();
  const windowIn = phase(f, 0.1, 0.85, easeOut);
  const reviewIn = phase(f, 1.75, 2.25, easeOut);
  const working = f / 30 >= 7.0;
  const replyReveal = phase(f, 6.8, 8.1);
  const typing = f / 30 >= 6.15 && f / 30 < 6.85;
  const statusFlip = phase(f, 6.9, 7.3);
  const landing = 1 - phase(f, 2.1, 3.4);
  const source = sceneSource("payoff");

  if (source) {
    return (
      <div className="pp-stage pp-dark">
        <div className="pp-grain" />
        <SourceRenderer source={source} width={1920} height={1080} fit="contain" />
      </div>
    );
  }

  return (
    <div className="pp-stage pp-paper pp-dots">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div
        style={{
          position: "absolute",
          left: 252,
          top: 96,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.18em",
          color: "#6f7d72",
          opacity: windowIn,
        }}
      >
        THE THREAD · T3 CODE · auth-refresh-fix
      </div>

      <div
        className="pp-t3"
        style={{
          left: 250,
          top: 126,
          width: 1420,
          height: 772,
          opacity: windowIn,
          transform: `translateY(${(1 - windowIn) * 18}px)`,
        }}
      >
        <div className="pp-t3-titlebar">
          <div className="pp-t3-dots">
            <i />
            <i />
            <i />
          </div>
          <div className="pp-t3-title">
            <b>T3 Code</b> &nbsp;/&nbsp; acme-web
          </div>
          <div className="pp-t3-titlebar-right">
            <span>orchestration / threads</span>
            <span>⌘K</span>
          </div>
        </div>

        <div className="pp-t3-body">
          <div className="pp-t3-sidebar">
            <div className="pp-t3-logo">
              <i>
                <Mark size={14} width={2} />
              </i>
              T3 Code
            </div>
            <div className="pp-t3-project">ACME-WEB / 4 ACTIVE</div>
            {SIDEBAR.map((thread) => (
              <div key={thread.id} className={`pp-t3-thread ${thread.active ? "active" : ""}`}>
                <div className="pp-t3-thread-title">{thread.id}</div>
                <div className={`pp-t3-thread-sub ${thread.need ? "need" : ""}`}>
                  <i />
                  {thread.sub}
                </div>
              </div>
            ))}
            <div className="pp-t3-side-foot">
              3 threads need you
              <br />
              local agent · 127.0.0.1
            </div>
          </div>

          <div className="pp-t3-main">
            <div className="pp-t3-mainhead">
              <div className="pp-t3-threadname">auth-refresh-fix</div>
              <div className={`pp-t3-status ${working ? "work" : ""}`}>
                <i />
                {working ? "WORKING" : "NEEDS YOUR REVIEW"}
              </div>
              <div className="pp-t3-mainhead-right">acme-web / main · Codex</div>
            </div>

            <div className="pp-t3-scroll">
              <div className="pp-t3-msg">
                <div className="pp-t3-avatar">CX</div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="pp-t3-msg-head">
                    <b>CODEX</b>
                    <span>2:04 PM · plan</span>
                  </div>
                  <div className="pp-t3-msg-body">
                    <p>Plan: stop the “logged out mid-edit” 401s</p>
                    <div className="pp-t3-plan">
                      <div className="pp-t3-plan-title">7 steps · waiting for review</div>
                      <div className="pp-t3-plan-step">
                        <b>1</b>
                        Add session family + rotation columns
                      </div>
                      <div className="pp-t3-plan-step hot">
                        <b>4</b>
                        Force-logout every user by truncating the sessions table
                      </div>
                      <div className="pp-t3-plan-step hot">
                        <b>6</b>
                        Wrap refreshToken() in a mutex
                      </div>
                      <div className="pp-t3-plan-step" style={{color: "#8b9588"}}>
                        <b>+</b>
                        4 more steps
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="pp-t3-msg"
                style={{
                  opacity: reviewIn,
                  transform: `translateY(${(1 - reviewIn) * 14}px)`,
                }}
              >
                <div className="pp-t3-avatar" style={{background: "#dcebdd", color: "#35603e"}}>
                  YOU
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="pp-t3-msg-head">
                    <b>YOU</b>
                    <span>2:06 PM · from Even G2</span>
                  </div>
                  <div
                    className="pp-t3-review"
                    style={{
                      marginTop: 7,
                      boxShadow: landing > 0 ? `0 0 0 ${landing * 3}px rgba(95,154,98,${landing * 0.18})` : undefined,
                    }}
                  >
                    <div className="pp-t3-review-head">
                      <b>Review from G2 (Pinpoint)</b>
                      <span>— 7 points</span>
                      <span className="g2">SENT FROM EVEN G2</span>
                    </div>
                    {REVIEW.map((line, index) => {
                      const reveal = phase(f, 2.25 + index * 0.45, 2.6 + index * 0.45);
                      return (
                        <div
                          key={line.quote}
                          className={`pp-t3-line ${line.cls}`}
                          style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 5}px)`}}
                        >
                          <b>{line.key}</b>
                          <span>
                            {line.plain ? (
                              <>
                                {line.quote} {line.arrow}
                              </>
                            ) : (
                              <>
                                <span className="q">“{line.quote}”</span>{" "}
                                <span className="arrow">→</span> {line.arrow}
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pp-t3-msg" style={{opacity: 1}}>
                <div className="pp-t3-avatar">CX</div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="pp-t3-msg-head">
                    <b>CODEX</b>
                    <span>2:07 PM · agent</span>
                  </div>
                  {typing ? (
                    <div className="pp-t3-typing">
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : null}
                  <div
                    className="pp-t3-reply"
                    style={{
                      opacity: replyReveal > 0 ? 1 : 0,
                      clipPath: `inset(0 ${Math.max(0, 100 - replyReveal * 100)}% 0 0)`,
                    }}
                  >
                    <div className="pp-t3-reply-head">
                      <b>Revised plan</b>
                      <span>· keeps working</span>
                    </div>
                    <div className="pp-t3-reply-body">
                      Migrate existing sessions instead of truncating. Request queue in place of the mutex. Re-running the
                      auth tests now.
                    </div>
                    {working ? (
                      <div className="pp-t3-working">
                        <span className="bars">
                          {[0, 1, 2, 3, 4].map((bar) => (
                            <i
                              key={bar}
                              style={{
                                height: 3 + 7 * Math.abs(Math.sin(f / 5 + bar * 0.7)),
                                opacity: 0.55 + 0.45 * Math.abs(Math.sin(f / 7 + bar)),
                              }}
                            />
                          ))}
                        </span>
                        WORKING · auth tests
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="pp-t3-composer">
              <div className="pp-t3-input">Reply to Codex…</div>
              <div className="pp-t3-send">SEND</div>
            </div>
          </div>
        </div>
      </div>

      <div className="pp-t3-disclosure">ILLUSTRATIVE T3 CODE UI · REAL THREAD CAPTURE PENDING</div>

      <div
        style={{
          position: "absolute",
          right: 250,
          top: 916,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "#6f7f71",
          opacity: phase(f, 7.2, 8.0),
        }}
      >
        <span style={{width: 6, height: 6, borderRadius: "50%", background: "#4f8a54"}} />
        CITATION → STEP 04, STEP 06
      </div>
    </div>
  );
}
