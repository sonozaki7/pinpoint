import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {CSSProperties, ReactNode} from "react";
import {Tag} from "../components/Bits";
import t3 from "../t3-real.json";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

function Shot({src, style, pos = "left top"}: {src: string; style: CSSProperties; pos?: string}) {
  return (
    <div className="pf-screen" style={{position: "absolute", borderRadius: 16, ...style}}>
      <Img src={staticFile(src)} style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: pos, display: "block"}} />
    </div>
  );
}

function Head({tag, text, x = 120, y = 36, sample = false}: {tag: string; text: string; x?: number; y?: number; sample?: boolean}) {
  return (
    <div style={{position: "absolute", left: x, top: y, display: "flex", alignItems: "center", gap: 16}}>
      <Tag sample={sample} style={{fontSize: 17, padding: "10px 16px"}}>
        {tag}
      </Tag>
      <span style={{fontSize: 34, fontWeight: 680, letterSpacing: "-.6px"}}>{text}</span>
    </div>
  );
}

/** A full-screen phase: fades in/out inside [a, b]. */
function Phase({a, b, local, children}: {a: number; b: number; local: number; children: ReactNode}) {
  const k = interpolate(local, [a, a + 0.4, b - 0.35, b], [0, 1, 1, 0], clamp);
  if (k <= 0) return null;
  return (
    <AbsoluteFill style={{opacity: k, transform: `scale(${interpolate(k, [0, 1], [0.985, 1])})`}}>{children}</AbsoluteFill>
  );
}

export function Proof() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const local = frame / fps;
  const collage = interpolate(local, [10.1, 10.8], [0, 1], clamp);

  return (
    <AbsoluteFill className="pf-scene">
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 30%, rgba(30,74,52,.14) 0%, rgba(5,7,6,0) 60%)"}} />

      <Phase a={0.1} b={4.9} local={local}>
        <Head tag="Real · Notion" text="A comment on the exact paragraph" />
        <Shot src="proof/notion-title.png" style={{left: 160, top: 100, width: 1600, height: 150}} />
        <Shot src="proof/notion-comment.png" style={{left: 160, top: 262, width: 1600, height: 695}} />
      </Phase>

      <Phase a={4.7} b={6.9} local={local}>
        <Head tag="Real · Gmail" text="Sent, with your spoken change applied" />
        <Shot src="proof/gmail-sent.png" style={{left: 110, top: 190, width: 1700, height: 309}} />
        <div style={{position: "absolute", left: 110, top: 540, fontSize: 36, color: "#96a69c", letterSpacing: "-.4px"}}>
          Draft said <b style={{color: "#ff9a8d", textDecoration: "line-through"}}>net-60</b>. You said <i>“Net forty-five, not net sixty.”</i> Sent as{" "}
          <b style={{color: "#3dff8a"}}>net-45</b>.
        </div>
      </Phase>

      <Phase a={6.7} b={10.5} local={local}>
        <Head tag="Real · Telegram" text="Your note, pinned to the exact sentence" />
        <Shot src="proof/telegram-v2-notes.png" style={{left: 90, top: 100, width: 880, height: 600}} pos="center top" />
        <Shot src="proof/telegram-v2-gmail.png" style={{left: 1000, top: 100, width: 830, height: 566}} pos="center top" />
        <div style={{position: "absolute", left: 90, top: 726, fontSize: 28, color: "#96a69c", maxWidth: 1700, letterSpacing: "-.2px"}}>
          Real messages from the Pinpoint bot, about the sample workspace. Tap Approve, Agree all or Send as written without opening the glasses.
        </div>
      </Phase>

      <div style={{opacity: collage}}>
        <Head tag="Real" text="Every proof is captured, not mocked" y={40} />
        <Shot src="proof/notion-comment.png" style={{left: 90, top: 130, width: 800, height: 347}} />
        <Shot src="proof/gmail-sent.png" style={{left: 920, top: 130, width: 910, height: 166}} />
        <Shot src="proof/telegram-v2-notes.png" style={{left: 920, top: 316, width: 330, height: 225}} pos="center top" />
        <Shot src="proof/telegram-v2-card.png" style={{left: 1280, top: 316, width: 330, height: 225}} pos="center top" />
        <Shot src="proof/telegram-v2-gmail.png" style={{left: 1640, top: 316, width: 190, height: 225}} pos="center top" />

        <div style={{position: "absolute", left: 90, right: 90, top: 590, display: "flex", gap: 24}}>
          <div className="pf-card" style={{flex: 1.15, padding: "24px 32px"}}>
            <Tag>Real · T3 Code · Codex</Tag>
            <div style={{fontSize: 36, fontWeight: 680, letterSpacing: "-.7px", marginTop: 14, lineHeight: 1.15}}>
              Review sent.
              <br />
              The agent answered.
            </div>
          </div>
          <div className="pf-card" style={{flex: 1, padding: "24px 32px"}}>
            <div className="pf-summary-num" style={{fontSize: 84, color: "#3dff8a"}}>{t3.login.seconds} s</div>
            <div className="pf-summary-label">Login fix: plan corrected</div>
          </div>
          <div className="pf-card" style={{flex: 1, padding: "24px 32px"}}>
            <div className="pf-summary-num" style={{fontSize: 84, color: "#3dff8a"}}>{t3.saturday.seconds} s</div>
            <div className="pf-summary-label">Saturday plan: indoor lunch</div>
          </div>
        </div>
        <div style={{position: "absolute", left: 90, right: 90, top: 830, display: "flex", gap: 28, alignItems: "center", fontSize: 26, color: "#96a69c"}}>
          <Tag>Real</Tag>
          <span>live agent, live Notion, live Gmail, live bot</span>
          <span style={{width: 24}} />
          <Tag sample>Sample</Tag>
          <span>the built-in demo workspace on the glasses</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
