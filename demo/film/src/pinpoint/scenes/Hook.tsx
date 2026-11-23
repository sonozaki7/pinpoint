import {interpolate, useCurrentFrame} from "remotion";
import fixture from "../fixtures/auth-refresh-fix.json";
import {Lens} from "../ui";
import {easeInOut, mix, phase} from "../ui";

const COLUMNS = 5;

function splitWall(text: string): string[][] {
  const lines = text.split("\n");
  const total = lines.reduce((sum, line) => sum + line.length + 1, 0);
  const target = Math.ceil(total / COLUMNS);
  const columns: string[][] = Array.from({length: COLUMNS}, () => []);
  let column = 0;
  let count = 0;
  for (const line of lines) {
    if (count > target && column < COLUMNS - 1) {
      column += 1;
      count = 0;
    }
    columns[column].push(line);
    count += line.length + 1;
  }
  return columns;
}

const wall = splitWall(fixture.source.text);
const points = fixture.deck.points.slice(0, 7);

export function Hook() {
  const f = useCurrentFrame();
  const collapse = phase(f, 3.15, 4.35, easeInOut);
  const lineWidth = phase(f, 3.7, 4.4);
  const lensIn = phase(f, 4.15, 5.0, easeInOut);
  const wallFade = 1 - phase(f, 4.05, 4.5);
  const endFade = 1 - phase(f, 11.35, 12);

  const wallClip = interpolate(collapse, [0, 1], [0, 47]);
  const wallSquash = mix(1, 0.1, collapse);
  const wallScale = mix(1.035, 1.0, collapse);

  return (
    <div className="pp-stage pp-dark" style={{opacity: endFade}}>
      <div className="pp-grain" />
      <div className="pp-vignette" />

      <div className="pp-wall-mask" style={{opacity: wallFade}}>
        <div
          className="pp-wall"
          style={{
            clipPath: `inset(${wallClip}% 0% ${wallClip}% 0%)`,
            transform: `scale(${wallScale}) scaleY(${wallSquash})`,
            filter: `blur(${collapse * 1.4}px)`,
          }}
        >
          {wall.map((column, index) => (
            <div
              key={index}
              className={`pp-wall-col ${index === 2 || index === 3 ? "bright" : ""}`}
              style={{transform: `translateY(${-260 - index * 85 - f * 2.2}px)`}}
            >
              {[0, 1, 2].map((copy) => (
                <div key={copy} style={{opacity: copy === 0 ? 1 : 0.72}}>
                  {column.map((line, i) => {
                    const strong = /^\s*(4\.|6\.)/.test(line) || line.includes("TRUNCATE");
                    return (
                      <p key={i} style={strong ? {color: "#d8ffd0"} : undefined}>
                        {line.length ? line : "\u00a0"}
                      </p>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(7,11,12,.92) 0%, rgba(7,11,12,.45) 9%, transparent 22%, transparent 76%, rgba(7,11,12,.55) 91%, rgba(7,11,12,.92) 100%)",
          opacity: wallFade,
          pointerEvents: "none",
        }}
      />

      <div
        className="pp-hook-rule"
        style={{width: `${lineWidth * 980}px`, opacity: lineWidth * (1 - phase(f, 4.55, 4.95))}}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: lensIn,
          transform: `scaleY(${mix(0.035, 1, lensIn)})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Lens style={{left: 354, top: 204}} label="EVEN G2 · PLAN" meta="7 POINTS · SILENCE AGREES">
          <div className="pp-hook-lines">
            <div className="pp-hook-head">
              <b>auth-refresh-fix</b>
              <span>plan · 7 steps</span>
            </div>
            <div className="pp-hook-points">
              {points.map((point, index) => {
                const reveal = phase(f, 5.0 + index * 0.16, 5.42 + index * 0.16);
                return (
                  <div
                    key={point.id}
                    className={`pp-hook-point ${point.kind === "risk" ? "risk" : ""}`}
                    style={{opacity: reveal, transform: `translateY(${(1 - reveal) * 7}px)`}}
                  >
                    <b>{point.kind === "risk" ? "!" : "o"}</b>
                    <span>{point.glance}</span>
                  </div>
                );
              })}
            </div>
            <div className="pp-hook-foot">
              <span>silence means agree</span>
              <span>1 / 7</span>
            </div>
          </div>
        </Lens>
      </div>

      <div
        style={{
          position: "absolute",
          left: 360,
          bottom: 118,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "#7b9186",
          opacity: phase(f, 1.4, 2.2) * (1 - phase(f, 4.2, 4.8)),
        }}
      >
        AUTH-REFRESH-FIX · 511 WORDS · T3 CODE
      </div>
      <div
        style={{
          position: "absolute",
          right: 360,
          bottom: 118,
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "#7b9186",
          opacity: phase(f, 1.8, 2.6) * (1 - phase(f, 4.2, 4.8)),
        }}
      >
        STILL WRITING WHEN YOU LEFT
      </div>
    </div>
  );
}
