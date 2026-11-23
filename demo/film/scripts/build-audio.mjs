#!/usr/bin/env node
// Narration build for the Pinpoint film.
//
// 1. Reads a script (default src/pinpoint/narration.json; teaser uses
//    src/pinpoint/teaser-narration.json).
// 2. Synthesizes each line locally: Kokoro (Apache-2.0, via .venv) when the
//    model files are present, otherwise macOS `say` as the documented fallback.
// 3. Measures it, writes burned-in caption cues (unless `captions: false`).
// 4. Places every line at its start time and writes one voice track.
// 5. Synthesizes a quiet ambient bed at `bedFile`.
//
// Swapping in the author's recording: put the take at public/audio/... and set
// audio.narration in src/clips.json. Do not re-run this after the final is in
// place unless you want the generated draft/captions refreshed.
//
//   node scripts/build-audio.mjs
//   node scripts/build-audio.mjs --script src/pinpoint/teaser-narration.json
//   node scripts/build-audio.mjs --tts say --voice Samantha --rate 170

import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const srcDir = join(film, "src/pinpoint");
const outDir = join(film, "../out/audio-build");
const publicAudio = join(film, "public/audio");

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const scriptPath = resolve(film, value("--script", "src/pinpoint/narration.json"));
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const tts = value("--tts", script.tts ?? "say");
const voice = value("--voice", script.voice ?? (tts === "kokoro" ? "af_heart" : "Samantha"));
const rate = Number(value("--rate", script.rate ?? 170));
const speed = Number(value("--speed", script.speed ?? 1.0));
const duration = Number(script.duration ?? 140);
const withBed = !argv.includes("--no-bed") && Boolean(script.bedFile);
const wantCaptions = script.captions !== false && !argv.includes("--no-captions");
const voiceOut = join(publicAudio, script.voiceFile ?? "pinpoint-voice-draft.mp3");
const bedOut = script.bedFile ? join(publicAudio, script.bedFile) : null;

mkdirSync(outDir, {recursive: true});
mkdirSync(publicAudio, {recursive: true});

const run = (bin, args, opts = {}) => {
  const out = execFileSync(bin, args, {stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts});
  return out ? out.toString().trim() : "";
};

const probeDuration = (file) =>
  Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));

console.log(`${tts} ${voice}${tts === "kokoro" ? ` · speed ${speed}` : ` · ${rate} wpm`} · ${script.lines.length} lines · ${duration}s\n`);

const measured = [];
if (tts === "kokoro") {
  const python = join(film, ".venv/bin/python");
  const model = join(film, ".models/kokoro-v1.0.onnx");
  const voices = join(film, ".models/voices-v1.0.bin");
  if (!existsSync(python) || !existsSync(model) || !existsSync(voices)) {
    throw new Error(
      "Kokoro is not installed. Expected .venv/bin/python, .models/kokoro-v1.0.onnx and .models/voices-v1.0.bin. " +
        "Install it, or run with --tts say to use the macOS fallback.",
    );
  }
  const job = {
    model,
    voices,
    voice,
    speed,
    lang: script.lang ?? "en-us",
    result: join(outDir, "kokoro-result.json"),
    lines: script.lines.map((line, index) => ({
      id: line.id,
      text: line.text,
      out: join(outDir, `${String(index + 1).padStart(2, "0")}-${line.id}.wav`),
    })),
  };
  const jobPath = join(outDir, "kokoro-job.json");
  writeFileSync(jobPath, JSON.stringify(job, null, 2));
  console.log("loading Kokoro (first run takes a few seconds)…");
  run(python, [join(here, "kokoro_tts.py"), jobPath], {stdio: ["ignore", "inherit", "inherit"]});
  for (const [index, line] of script.lines.entries()) {
    const file = join(outDir, `${String(index + 1).padStart(2, "0")}-${line.id}.wav`);
    measured.push({...line, file, seconds: probeDuration(file)});
  }
} else {
  for (const [index, line] of script.lines.entries()) {
    const n = String(index + 1).padStart(2, "0");
    const aiff = join(outDir, `${n}-${line.id}.aiff`);
    const wav = join(outDir, `${n}-${line.id}.wav`);
    // Always re-synthesize: the text may have changed since the last run.
    run("say", ["-v", voice, "-r", String(rate), "-o", aiff, line.text]);
    run("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ar", "48000", "-ac", "1", wav]);
    measured.push({...line, file: wav, seconds: probeDuration(wav)});
  }
}

// Caption end = spoken end + a short hold, never past the next line.
const cues = measured.map((line, i) => {
  const next = measured[i + 1];
  const hold = 0.45;
  let end = Math.min(line.at + line.seconds + hold, duration - 0.2);
  if (next) end = Math.min(end, next.at - 0.12);
  if (end < line.at + line.seconds) {
    console.warn(`! ${line.id}: speech (${line.seconds.toFixed(2)}s) runs into the next line`);
    end = line.at + line.seconds;
  }
  return {
    id: line.id,
    start: Number(line.at.toFixed(2)),
    end: Number(end.toFixed(2)),
    text: line.text,
    seconds: Number(line.seconds.toFixed(2)),
  };
});

let previousEnd = 0;
for (const cue of cues) {
  if (cue.start < previousEnd - 0.01) console.warn(`! ${cue.id}: starts before the previous line ends`);
  previousEnd = Math.max(previousEnd, cue.start + cue.seconds);
}

if (wantCaptions) {
  const captionsPath = resolve(film, value("--captions", "src/pinpoint/captions.generated.json"));
  writeFileSync(
    captionsPath,
    JSON.stringify(
      {
        note: "Generated by scripts/build-audio.mjs from narration.json. Edit the narration, not this file.",
        voice,
        tts,
        duration,
        cues,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`captions ${captionsPath}`);
}

const speech = cues.reduce((sum, cue) => sum + cue.seconds, 0);
for (const cue of cues) {
  console.log(
    `${cue.id.padEnd(12)} ${cue.start.toFixed(1).padStart(6)} → ${cue.end.toFixed(1).padStart(6)}  ${cue.seconds
      .toFixed(2)
      .padStart(5)}s  ${cue.text}`,
  );
}
console.log(`\nspoken ${speech.toFixed(1)}s across ${cues.length} lines (${((speech / duration) * 100).toFixed(0)}% of the cut)\n`);

// ------------------------------------------------------------------ voice mix
const inputs = ["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration}`];
for (const line of measured) inputs.push("-i", line.file);
const filters = [];
const mixInputs = ["[0:a]"];
measured.forEach((line, i) => {
  const delay = Math.round(line.at * 1000);
  filters.push(`[${i + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${delay}|${delay}[v${i}]`);
  mixInputs.push(`[v${i}]`);
});
filters.push(
  `${mixInputs.join("")}amix=inputs=${measured.length + 1}:duration=first:normalize=0,` +
    `highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=9,alimiter=limit=0.94[out]`,
);
run("ffmpeg", [
  "-y", "-v", "error", ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "[out]", "-t", String(duration),
  "-c:a", "libmp3lame", "-b:a", "192k", voiceOut,
]);
console.log(`voice  ${voiceOut}`);

// -------------------------------------------------------------------- ambient bed
if (withBed && bedOut) {
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `sine=frequency=55:sample_rate=48000:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=82.41:sample_rate=48000:duration=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=110:sample_rate=48000:duration=${duration}`,
    "-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:amplitude=0.3:duration=${duration}`,
    "-filter_complex",
    [
      "[0:a]volume=0.055,tremolo=f=0.10:d=0.35[a0]",
      "[1:a]volume=0.035,tremolo=f=0.13:d=0.45[a1]",
      "[2:a]volume=0.018,tremolo=f=0.17:d=0.5[a2]",
      "[3:a]lowpass=f=700,volume=0.010[a3]",
      "[a0][a1][a2][a3]amix=inputs=4:normalize=0,highpass=f=35,lowpass=f=5000," +
        `afade=t=in:st=0:d=5,afade=t=out:st=${duration - 6}:d=6,` +
        "loudnorm=I=-32:TP=-9:LRA=6,alimiter=limit=0.28[out]",
    ].join(";"),
    "-map", "[out]", "-t", String(duration),
    "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", bedOut,
  ]);
  console.log(`bed    ${bedOut}`);
}
