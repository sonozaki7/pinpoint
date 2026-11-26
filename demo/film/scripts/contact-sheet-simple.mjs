#!/usr/bin/env node
// Time-labelled contact sheet for the v3 cut: one frame every 3 seconds,
// 5 columns x 7 rows, each tile 480x270.
//
//   node scripts/contact-sheet-simple.mjs
//   node scripts/contact-sheet-simple.mjs --input ../out/pinpoint-demo-v3.mp4 --out ../out/v3-sheet.png

import {execFileSync} from "node:child_process";
import {mkdirSync, rmSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const input = resolve(film, value("--input", "../out/pinpoint-demo-v3.mp4"));
const out = resolve(film, value("--out", "../out/v3-sheet.png"));
const tmp = resolve(film, "../out/v3-sheet-frames");
const font = "/System/Library/Fonts/Helvetica.ttc";
const run = (bin, args) => execFileSync(bin, args, {stdio: ["ignore", "pipe", "pipe"]}).toString();

const duration = Number(
  run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).trim(),
);
if (!Number.isFinite(duration) || duration <= 0) throw new Error(`bad duration for ${input}`);

rmSync(tmp, {recursive: true, force: true});
mkdirSync(tmp, {recursive: true});

const count = 35;
const start = 0.8;
const end = Math.min(duration - 1.9, 101.2);
const times = Array.from({length: count}, (_, i) => start + (i / (count - 1)) * (end - start));

for (const [i, t] of times.entries()) {
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, "0");
  const rawLabel = `${mm}:${ss}`;
  const label = rawLabel.replace(":", "\\:");
  const file = join(tmp, `frame-${String(i + 1).padStart(2, "0")}.png`);
  run("ffmpeg", [
    "-y", "-v", "error",
    "-ss", t.toFixed(3), "-i", input,
    "-frames:v", "1",
    "-vf",
    `scale=480:270,drawtext=fontfile=${font}:text='${label}':x=14:y=236:fontsize=20:` +
      "fontcolor=0xEAF2EC:box=1:boxcolor=0x000000@0.72:boxborderw=6",
    file,
  ]);
  console.log(`${String(i + 1).padStart(2, "0")}  ${rawLabel}  ${t.toFixed(1)}s`);
}

run("ffmpeg", [
  "-y", "-v", "error",
  "-framerate", "1", "-start_number", "1",
  "-i", join(tmp, "frame-%02d.png"),
  "-frames:v", "1",
  "-vf", "tile=5x7:padding=8:margin=12:color=0x0b0f0e",
  out,
]);

console.log(`\n${out}  (${count} frames, one every ~3 s, from ${duration.toFixed(1)}s)`);
