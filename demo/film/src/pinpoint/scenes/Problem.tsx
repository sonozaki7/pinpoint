import {interpolate, useCurrentFrame} from "remotion";
import {clampOpts, easeInOut, easeOut, phase} from "../ui";

export function Problem() {
  const f = useCurrentFrame();
  const cardIn = phase(f, 0.15, 0.7);
  const hit = phase(f, 2.55, 2.75);
  const ripple = phase(f, 2.5, 3.25, easeOut);
  const stamp = phase(f, 3.1, 3.55, easeOut);
  const labels = phase(f, 3.9, 4.5);
  const cardOut = phase(f, 6.25, 7.0, easeInOut);
  const small = phase(f, 7.45, 7.9);
  const big = phase(f, 7.8, 8.35, easeOut);
  const rule = phase(f, 8.4, 9.0, easeInOut);

  return (
    <div className="pp-stage pp-paper pp-dots">
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div className="pp-problem-kicker" style={{opacity: cardIn * (1 - cardOut)}}>
        A TYPICAL REVIEW REQUEST · TODAY
      </div>

      <div
        className="pp-request"
        style={{
          opacity: cardIn * (1 - cardOut),
          transform: `translateY(${(1 - cardIn) * 16}px) scale(${1 - cardOut * 0.025})`,
        }}
      >
        <div className="pp-request-top">
          <i />
          <span>AGENT REQUEST</span>
          <span>now</span>
        </div>
        <h2>Apply the plan?</h2>
        <p>7 steps · auth-refresh-fix</p>
        <div className="pp-request-actions">
          <div className="pp-btn pp-btn-yes" style={{background: hit > 0 ? "#0d171c" : undefined, color: "#f7f6f0"}}>
            Yes
          </div>
          <div className="pp-btn pp-btn-no">No</div>
          {ripple > 0 && ripple < 1 ? (
            <div
              className="pp-ripple"
              style={{opacity: 1 - ripple, transform: `scale(${1 + ripple * 0.14})`}}
            />
          ) : null}
        </div>
        <div
          className="pp-stamp"
          style={{top: 96, opacity: stamp, transform: `rotate(-6deg) scale(${interpolate(stamp, [0, 1], [1.5, 1], clampOpts)})`}}
        >
          APPROVED
        </div>
      </div>

      <div className="pp-ask" style={{left: 1360, top: 268, opacity: labels * (1 - phase(f, 6.1, 6.55))}}>
        which step?
      </div>
      <div className="pp-ask" style={{left: 1360, top: 400, opacity: labels * 0.8 * (1 - phase(f, 6.1, 6.55))}}>
        why this way?
      </div>
      <div className="pp-ask" style={{left: 1360, top: 506, opacity: labels * 0.8 * (1 - phase(f, 6.1, 6.55))}}>
        what instead?
      </div>

      <div className="pp-contrast">
        <div className="pp-contrast-small" style={{opacity: small}}>
          EVERYONE BUILT “APPROVE FROM YOUR GLASSES”.
        </div>
        <div
          className="pp-contrast-big"
          style={{opacity: big, transform: `translateY(${(1 - big) * 18}px)`}}
        >
          Approval isn’t <em>feedback.</em>
        </div>
        <div className="pp-contrast-rule" style={{width: 76 * rule, opacity: rule}} />
      </div>
    </div>
  );
}
