import {useCurrentFrame, useVideoConfig} from "remotion";
import generated from "../captions.generated.json";
import {EXTRA_CUES, CAPTION_TEXT, type ExtraCue} from "../data";

type VoiceCue = {
  id: string;
  start: number;
  end: number;
  text: string;
  seconds: number;
  style?: string;
};

const HIDDEN = new Set(["s4", "s8", "s9"]);

export function Captions() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;

  const voice = (generated as {cues: VoiceCue[]}).cues.filter((cue) => !HIDDEN.has(cue.id));
  const extras: ExtraCue[] = EXTRA_CUES;
  const cue =
    [...voice, ...extras]
      .filter((item) => seconds >= item.start && seconds < item.end)
      .sort((a, b) => a.start - b.start)
      .at(-1) ?? null;

  if (!cue) return null;
  const isQuote = "style" in cue && cue.style === "quote";
  const isLabel = "style" in cue && cue.style === "label";
  const display = CAPTION_TEXT[cue.id] ?? cue.text;

  return (
    <div className="ps-caption-wrap">
      <div className={`ps-caption${isQuote ? " is-quote" : ""}${isLabel ? " is-label" : ""}`}>
        {isQuote ? (
          <>
            <span className="qmark">“</span>
            {display}
            <span className="qmark">”</span>
          </>
        ) : (
          display
        )}
      </div>
    </div>
  );
}
