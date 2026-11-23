import {useCurrentFrame} from "remotion";
import {Rich} from "../rich";
import {T3_BULLET_4, T3_BULLET_6, T3_PLAN_TITLE, T3_PROOF, T3_REPLY_HEAD, T3_RETRY, T3_REVIEW_HEAD, T3_REVIEW_LINES, T3_STEP_6} from "../t3";
import {Mark, easeOut, phase} from "../ui";

export function Payoff() {
  const f = useCurrentFrame();
  const windowIn = phase(f, 0.1, 0.85, easeOut);
  const contextIn = phase(f, 0.7, 1.15, easeOut);
  const reviewIn = phase(f, 1.2, 1.7, easeOut);
  const replyIn = phase(f, 3.6, 4.2, easeOut);
  const planIn = phase(f, 6.2, 6.9, easeOut);
  const proofIn = phase(f, 7.0, 7.6, easeOut);
  const citationIn = phase(f, 8.0, 8.6, easeOut);
  const landing = 1 - phase(f, 1.5, 2.8);

  return (
    <div className="pp-stage pp-paper pp-dots">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div
        style={{
          position: "absolute",
          left: 250,
          top: 80,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.16em",
          color: "#5f7067",
          opacity: windowIn,
        }}
      >
        Real thread · exported from T3 Code
      </div>
      <div
        style={{
          position: "absolute",
          right: 250,
          top: 80,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "#7b887d",
          opacity: windowIn,
        }}
      >
        auth-refresh-fix · 4 messages · completed
      </div>

      <div
        className="pp-t3"
        style={{
          left: 250,
          top: 104,
          width: 1420,
          height: 800,
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
            <b>T3 Code</b> &nbsp;/&nbsp; pinpoint
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
            <div className="pp-t3-project">PINPOINT / 1 THREAD</div>
            <div className="pp-t3-thread active">
              <div className="pp-t3-thread-title">auth-refresh-fix</div>
              <div className="pp-t3-thread-sub need">
                <i />
                opencode · completed
              </div>
            </div>
            <div className="pp-t3-side-foot">
              local agent · 127.0.0.1
              <br />
              exported 18:51 UTC
            </div>
          </div>

          <div className="pp-t3-main">
            <div className="pp-t3-mainhead">
              <div className="pp-t3-threadname">auth-refresh-fix</div>
              <div className="pp-t3-status work">
                <i />
                COMPLETED
              </div>
              <div className="pp-t3-mainhead-right">pinpoint / main · opencode</div>
            </div>

            <div className="pp-t3-scroll" style={{padding: "20px 32px 16px"}}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  marginBottom: 14,
                  borderRadius: 7,
                  border: "1px solid #e4dfd0",
                  background: "#f6f3ea",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                  letterSpacing: "0.015em",
                  color: "#5d6b62",
                  opacity: contextIn,
                }}
              >
                <span style={{color: "#8f9a8d"}}>PLAN</span>
                <span>{T3_PLAN_TITLE}</span>
                <span style={{marginLeft: "auto", color: "#3f6a45"}}>7 steps · review sent</span>
              </div>

              <div className="pp-t3-msg" style={{opacity: reviewIn, transform: `translateY(${(1 - reviewIn) * 14}px)`}}>
                <div className="pp-t3-avatar" style={{background: "#dcebdd", color: "#35603e"}}>
                  YOU
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="pp-t3-msg-head">
                    <b>YOU</b>
                    <span>18:49:03 UTC · from Even G2</span>
                  </div>
                  <div
                    className="pp-t3-review"
                    style={{
                      marginTop: 7,
                      boxShadow: landing > 0 ? `0 0 0 ${landing * 3}px rgba(95,154,98,${landing * 0.18})` : undefined,
                    }}
                  >
                    <div className="pp-t3-review-head">
                      <b>{T3_REVIEW_HEAD}</b>
                      <span className="g2">SENT FROM EVEN G2</span>
                    </div>
                    {T3_REVIEW_LINES.map((line, index) => {
                      const key = line.slice(0, 1);
                      const text = line.slice(1).trimStart();
                      const cls = key === "✗" ? "object" : key === "✓" ? "agreed" : "note";
                      const reveal = phase(f, 1.55 + index * 0.35, 1.95 + index * 0.35);
                      return (
                        <div
                          key={key + index}
                          className={`pp-t3-line ${cls}`}
                          style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 5}px)`}}
                        >
                          <b>{key}</b>
                          <span>{text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pp-t3-msg" style={{opacity: replyIn, transform: `translateY(${(1 - replyIn) * 14}px)`}}>
                <div className="pp-t3-avatar">OC</div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div className="pp-t3-msg-head">
                    <b>OPENCODE</b>
                    <span>18:49:10 UTC · 7 s later</span>
                  </div>
                  <div className="pp-t3-reply" style={{marginTop: 7, padding: "11px 14px"}}>
                    <div className="pp-t3-reply-head">
                      <b>{T3_REPLY_HEAD}</b>
                      <span>· revised plan follows</span>
                    </div>
                    <div className="pp-t3-reply-body" style={{marginTop: 7, fontSize: 15.5, lineHeight: 1.42}}>
                      <div className="pp-t3-bullet" style={{opacity: phase(f, 4.15, 4.55)}}>
                        <Rich text={T3_BULLET_4} />
                      </div>
                      <div className="pp-t3-bullet" style={{opacity: phase(f, 4.8, 5.2)}}>
                        <Rich text={T3_BULLET_6} />
                      </div>
                      <div
                        style={{
                          marginTop: 11,
                          paddingTop: 9,
                          borderTop: "1px solid #e4dfd0",
                          opacity: planIn,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "IBM Plex Mono, monospace",
                            fontSize: 9.5,
                            letterSpacing: "0.12em",
                            color: "#5e7c60",
                          }}
                        >
                          REVISED PLAN · STEP 06
                        </div>
                        <div style={{marginTop: 5, fontWeight: 600, color: "#2c4a31"}}>
                          <Rich text={T3_STEP_6} />
                        </div>
                        <div style={{marginTop: 4, color: "#4b5a4e"}}>
                          <Rich text={T3_RETRY} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pp-t3-composer">
              <div className="pp-t3-input">Reply to opencode…</div>
              <div className="pp-t3-send">SEND</div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 250,
          top: 930,
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          opacity: proofIn,
        }}
      >
        <span
          style={{
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 9.5,
            letterSpacing: "0.18em",
            color: "#7b887d",
          }}
        >
          MEASURED
        </span>
        <span style={{display: "inline-flex", flexDirection: "column", gap: 3}}>
          <span style={{fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "#22352b"}}>{T3_PROOF}</span>
          <span style={{fontFamily: "IBM Plex Mono, monospace", fontSize: 10, letterSpacing: "0.12em", color: "#63735f"}}>
            1 OBJECTION · 1 NOTE · 5 AGREED
          </span>
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          right: 250,
          top: 934,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          color: "#6f7f71",
          opacity: citationIn,
        }}
      >
        <span style={{width: 6, height: 6, borderRadius: "50%", background: "#4f8a54"}} />
        CITATION → STEP 04, STEP 06
      </div>
    </div>
  );
}
