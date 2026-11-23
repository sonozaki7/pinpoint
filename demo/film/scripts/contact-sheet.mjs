#!/usr/bin/env node
// 4×4 contact sheet for the rendered v2 cut. Extracts 16 evenly spaced frames,
// scales each to 480×270, adds a thin border, and tiles them.
//
//   node scripts/contact-sheet.mjs
//   node scripts/contact-sheet.mjs --input ../out/pinpoint-demo-v2.mp4

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

const input = resolve(film, value("--input", "../out/pinpoint-demo-v2.mp4"));
const out = resolve(film, value("--out", "../out/v2-sheet.png"));
const tmp = resolve(film, "../out/v2-sheet-frames");
const run = (bin, args) => execFileSync(bin, args, {stdio: ["ignore", "pipe", "pipe"]}).toString();

const duration = Number(
  run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]).trim(),
);
if (!Number.isFinite(duration) || duration <= 0) throw new Error(`bad duration for ${input}`);

rmSync(tmp, {recursive: true, force: true});
mkdirSync(tmp, {recursive: true});

const count = 16;
const start = 7.5;
const end = duration - 5.5;
for (let i = 0; i < count; i += 1) {
  const t = start + (i / (count - 1)) * (end - start);
  const file = join(tmp, `frame-${String(i + 1).padStart(2, "0")}.png`);
  run("ffmpeg", [
    "-y", "-v", "error",
    "-i", input,
    "-ss", t.toFixed(3),
    "-frames:v", "1",
    "-vf", "scale=480:270,pad=484:274:2:2:color=0x0b0f0e",
    file,
  ]);
  console.log(`${String(i + 1).padStart(2, "0")}  ${t.toFixed(1).padStart(6)}s`);
}

run("ffmpeg", [
  "-y", "-v", "error",
  "-framerate", "1",
  "-start_number", "1",
  "-i", join(tmp, "frame-%02d.png"),
  "-frames:v", "1",
  "-vf", "tile=4x4:padding=0:margin=0:color=0x0b0f0e",
  out,
]);

console.log(`\n${out}  (${count} frames from ${duration.toFixed(1)}s)`);
