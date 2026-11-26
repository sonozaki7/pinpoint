import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function Telegram() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const phoneIn = interpolate(local, [0.2, 0.9], [0, 1], clamp);
  const copyIn = interpolate(local, [0.7, 1.4], [0, 1], clamp);
  const quoteIn = interpolate(local, [1.6, 2.2], [0, 1], clamp);

  return (
    <AbsoluteFill className="ps-scene">
      <div className="ps-phone" style={{opacity: phoneIn, transform: `translateY(${interpolate(phoneIn, [0, 1], [20, 0])}px)`}}>
        <div className="ps-phone-screen">
          <div className="ps-phone-notch" />
          <div className="ps-tg-top">
            <div className="name">Pinpoint Desk</div>
            <div className="sub">login-fix · plan, 7 steps</div>
          </div>
          <div className="ps-tg-feed">
            <div className="ps-tg-pin">Pinned: Needs you · plan · 7 points</div>
            <div className="ps-tg-bubble">
              Plan: stop customers getting logged out at random. Seven steps, one line each.
              <div className="ps-tg-time">08:41</div>
            </div>
            <div className="ps-tg-bubble" style={{opacity: 0.94}}>
              Review from G2 (Pinpoint) — 7 points
              <br />
              <span style={{color: "#ffb0b0"}}>✗ 4. “Sign out every customer once…”</span>
              <br />
              <span style={{color: "#9fe8b8"}}>✓ Agreed: 1, 2, 3, 5, 6, 7.</span>
              <div className="ps-tg-time">08:42</div>
            </div>
            <div className="ps-tg-bubble mine" style={{opacity: quoteIn, transform: `translateY(${interpolate(quoteIn, [0, 1], [10, 0])}px)`}}>
              <div className="ps-tg-quote">
                Sign out every customer once, to clear out the broken logins.
                <span>Step 4 · from the plan</span>
              </div>
              Don't sign everyone out. Just fix the broken logins.
              <div className="ps-tg-time">08:42 ✓✓</div>
            </div>
          </div>
          <div className="ps-tg-composer">
            Message
            <span className="send">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M8 2v9M4.5 7.5 8 11l3.5-3.5" fill="none" stroke="#eafff0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className="ps-tg-tag">Telegram · sample workspace</div>
        </div>
      </div>

      <div className="ps-tg-copy" style={{opacity: copyIn, transform: `translateY(${interpolate(copyIn, [0, 1], [16, 0])}px)`}}>
        <div className="eyebrow">Telegram</div>
        <h2>Full text, on your phone.</h2>
        <div className="body">
          Your note sits on <b>the exact sentence</b> it changes. The rest of the plan stays in the chat, ready when you want it.
        </div>
      </div>
    </AbsoluteFill>
  );
}
