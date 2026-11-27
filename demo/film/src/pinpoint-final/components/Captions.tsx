import {useCurrentFrame, useVideoConfig} from "remotion";
import generated from "../captions.generated.json";

type VoiceCue = {
  id: string;
  start: number;
  end: number;
  text: string;
  seconds: number;
  caption?: string;
  style?: string;
};

/**
 * Burned-in captions. Narrator lines show a short caption (or none, when the
 * title card carries the text). The user's spoken notes show their exact words
 * as a quoted subtitle.
 */
export function Captions() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const cue =
    (generated as {cues: VoiceCue[]}).cues
      .filter((item) => seconds >= item.start && seconds < item.end)
      .sort((a, b) => a.start - b.start)
      .at(-1) ?? null;
  if (!cue) return null;
  const isQuote = cue.style === "quote";
  if (!isQuote && !cue.caption) return null;
  return (
    <div className="pf-caption-wrap">
      <div className={`pf-caption${isQuote ? " is-quote" : ""}`}>
        {isQuote ? (
          <>
            <span className="qmark">“</span>
            {cue.text}
            <span className="qmark">”</span>
          </>
        ) : (
          cue.caption
        )}
      </div>
    </div>
  );
}
