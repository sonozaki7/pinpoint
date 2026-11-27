#!/usr/bin/env node
// Narration + mix for the PinpointFinal cut (v5).
//
// Kokoro af_heart for the narrator, am_michael for the user's spoken note.
// The user line gets a light phone-mic EQ (high-pass, presence lift, gentle
// compression) so it reads as a voice captured by the glasses.
//
//   node scripts/build-audio-final.mjs
//
// Outputs:
//   public/audio/final-voice.wav          158 s, 48 kHz stereo, -16 LUFS
//   src/pinpoint-final/captions.generated.json
//   ../out/audio-simple/*.wav              per-line takes, for inspection

import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const scriptPath = join(film, "src/pinpoint-final/narration.json");
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const outDir = join(film, "../out/audio-final");
const publicAudio = join(film, "public/audio");
const layout = JSON.parse(readFileSync(join(film, "src/pinpoint-final/layout.generated.json"), "utf8"));
const duration = Math.ceil(layout.total * 10) / 10;
// "at" may be a number (seconds) or an anchor into the recordings: "walk.on@0.5" (mark + offset)
// or "scene:everyday@0.7" (scene start + offset).
const resolveAt = (at) => {
  if (typeof at === "number") return at;
  const [key, off = "0"] = String(at).split("@");
  const base = key.startsWith("scene:") ? layout.scenes[key.slice(6)]?.start : layout.marks[key];
  if (base === undefined) throw new Error(`narration anchor not found: ${at}`);
  return Number((base + Number(off)).toFixed(3));
};
for (const line of script.lines) line.at = resolveAt(line.at);
const speed = Number(script.speed ?? 1);
const lang = script.lang ?? "en-us";
const python = join(film, ".venv/bin/python");
const model = join(film, ".models/kokoro-v1.0.onnx");
const voices = join(film, ".models/voices-v1.0.bin");

mkdirSync(outDir, {recursive: true});
mkdirSync(publicAudio, {recursive: true});

if (!existsSync(python) || !existsSync(model) || !existsSync(voices)) {
  throw new Error("Kokoro is not installed (.venv, .models). See demo/film/AUDIO.md.");
}

const run = (bin, args, opts = {}) => {
  const out = execFileSync(bin, args, {stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024, ...opts});
  return out ? out.toString().trim() : "";
};
const probe = (file) =>
  Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));

const slug = (value) => value.replace(/[^a-z0-9_-]+/gi, "-");
const takes = [];

// One Kokoro job per voice so each line can use a different speaker.
const byVoice = new Map();
for (const line of script.lines) {
  const voice = line.voice ?? script.voice ?? "af_heart";
  if (!byVoice.has(voice)) byVoice.set(voice, []);
  byVoice.get(voice).push(line);
}

for (const [voice, lines] of byVoice) {
  const jobLines = lines.map((line) => ({
    id: line.id,
    text: line.text,
    out: join(outDir, `${slug(line.id)}.wav`),
  }));
  const job = {
    model,
    voices,
    voice,
    speed,
    lang,
    result: join(outDir, `kokoro-${slug(voice)}.json`),
    lines: jobLines,
  };
  const jobPath = join(outDir, `job-${slug(voice)}.json`);
  writeFileSync(jobPath, JSON.stringify(job, null, 2));
  console.log(`Kokoro ${voice}: ${lines.length} line${lines.length === 1 ? "" : "s"}…`);
  run(python, [join(here, "kokoro_tts.py"), jobPath], {stdio: ["ignore", "inherit", "inherit"]});
  for (const line of lines) {
    const raw = join(outDir, `${slug(line.id)}.wav`);
    const take = join(outDir, `${slug(line.id)}-take.wav`);
    if (line.eq === "phone") {
      run("ffmpeg", [
        "-y", "-v", "error", "-i", raw,
        "-af",
        [
          "highpass=f=150",
          "lowpass=f=6800",
          "equalizer=f=300:t=q:w=1:g=-2.5",
          "equalizer=f=1900:t=q:w=1:g=3.2",
          "acompressor=threshold=-20dB:ratio=3.5:attack=6:release=140:makeup=3",
          "alimiter=limit=0.92",
        ].join(","),
        "-ar", "48000", "-ac", "1", take,
      ]);
    } else {
      run("ffmpeg", [
        "-y", "-v", "error", "-i", raw,
        "-af", "highpass=f=75,acompressor=threshold=-20dB:ratio=2.4:attack=8:release=140:makeup=1.5",
        "-ar", "48000", "-ac", "1", take,
      ]);
    }
    takes.push({...line, voice, file: take, seconds: probe(take)});
  }
}

const ordered = [...takes].sort((a, b) => a.at - b.at);

const cues = ordered.map((line, i) => {
  const next = ordered[i + 1];
  const hold = 0.5;
  let end = Math.min(line.at + line.seconds + hold, duration - 0.2);
  if (next) end = Math.min(end, next.at - 0.08);
  if (end < line.at + line.seconds) end = line.at + line.seconds;
  return {
    id: line.id,
    start: Number(line.at.toFixed(2)),
    end: Number(end.toFixed(2)),
    text: line.text,
    seconds: Number(line.seconds.toFixed(2)),
    ...(line.caption ? {caption: line.caption} : {}),
    ...(line.eq === "phone" ? {style: "quote"} : {}),
  };
});

for (let i = 1; i < cues.length; i += 1) {
  const prev = cues[i - 1];
  if (cues[i].start < prev.start + prev.seconds - 0.01) {
    console.warn(`! ${cues[i].id} starts before ${prev.id} finishes`);
  }
}

writeFileSync(
  join(film, "src/pinpoint-final/captions.generated.json"),
  JSON.stringify(
    {
      note: "Generated by scripts/build-audio-final.mjs from narration.json. Edit the narration, not this file.",
      voice: script.voice,
      duration,
      cues,
    },
    null,
    2,
  ) + "\n",
);

console.log("\nline        start     end   spoken  text");
for (const cue of cues) {
  console.log(
    `${cue.id.padEnd(10)} ${cue.start.toFixed(1).padStart(6)} ${cue.end.toFixed(1).padStart(6)} ` +
      `${cue.seconds.toFixed(2).padStart(6)}s  ${cue.text}`,
  );
}

// Mix all takes onto one 158 s bed at their start times.
const inputs = ["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}`];
ordered.forEach((line) => inputs.push("-i", line.file));
const filters = [];
const mixInputs = ["[0:a]"];
ordered.forEach((line, i) => {
  const delay = Math.round(line.at * 1000);
  filters.push(
    `[${i + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `volume=${line.eq === "phone" ? 0.55 : 1.0},adelay=${delay}|${delay}[v${i}]`,
  );
  mixInputs.push(`[v${i}]`);
});
filters.push(
  `${mixInputs.join("")}amix=inputs=${ordered.length + 1}:duration=first:normalize=0,` +
    "loudnorm=I=-16:TP=-1.5:LRA=9,alimiter=limit=0.94[out]",
);

const mixOut = join(publicAudio, script.voiceFile ?? "final-voice.wav");
run("ffmpeg", [
  "-y", "-v", "error", ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "[out]", "-t", String(duration),
  "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", mixOut,
]);
console.log(`\nmix ${mixOut}`);

function measureLoudness(file) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-i", file,
    "-af", "ebur128=peak=true", "-f", "null", "-",
  ], {encoding: "utf8", maxBuffer: 32 * 1024 * 1024});
  const out = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const summary = out.split("Summary:")[1] ?? out;
  return {
    integrated: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]),
    truePeak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]),
  };
}

let loudness = measureLoudness(mixOut);
// loudnorm is close but not exact on short, sparse speech; converge to -16.
for (let pass = 0; pass < 3; pass += 1) {
  if (!Number.isFinite(loudness.integrated)) break;
  const trim = -16 - loudness.integrated;
  if (Math.abs(trim) <= 0.12) break;
  console.log(`loudness trim ${trim.toFixed(2)} dB (pass ${pass + 1})`);
  const tmp = join(outDir, "mix-trim.wav");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", mixOut,
    "-af", `volume=${trim.toFixed(2)}dB`,
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", tmp,
  ]);
  run("mv", [tmp, mixOut]);
  loudness = measureLoudness(mixOut);
}
console.log(`loudness  I ${loudness.integrated} LUFS · true peak ${loudness.truePeak} dBFS`);
