#!/usr/bin/env node
// Draws the 24x24 Even Hub store icon from the reticle mark.
//
// The CLI validates (see `pl()` in @evenrealities/evenhub-cli/main.js):
//   - exactly 24x24 PNG
//   - every visible (alpha > 0) pixel is opaque #F4F4F4
//   - every lit pixel starts a complete 2x2 block
// That means the artwork is a 12x12 logical grid where every cell is 2x2
// pixels. The background is transparent; the Hub draws the lit mask.
//
//   node scripts/make-icon.mjs
//
// Writes apps/glasses/icon-24.png and brand/pinpoint-icon-24-preview.png.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeRgbaPng } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const repo = resolve(app, "../..");

// 12x12 logical reticle: ring + centre dot (the mark from
// brand/pinpoint-avatar.svg, simplified so it survives at 24x24).
const MARK = [
  "............",
  "....####....",
  "..##....##..",
  "..#......#..",
  ".#........#.",
  ".#...##...#.",
  ".#...##...#.",
  ".#........#.",
  "..#......#..",
  "..##....##..",
  "....####....",
  "............",
];

const INK = [0xf4, 0xf4, 0xf4, 0xff];

function draw(scale, background, ink) {
  const size = 12 * scale;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = MARK[Math.floor(y / scale)]?.[Math.floor(x / scale)] ?? ".";
      const offset = (y * size + x) * 4;
      const color = cell === "#" ? ink : background;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
  return pixels;
}

const icon = encodeRgbaPng(24, 24, draw(2, [0, 0, 0, 0], INK));
const preview = encodeRgbaPng(96, 96, draw(8, [0x05, 0x07, 0x06, 0xff], INK));

mkdirSync(dirname(resolve(app, "icon-24.png")), { recursive: true });
writeFileSync(resolve(app, "icon-24.png"), icon);
mkdirSync(dirname(resolve(repo, "brand/pinpoint-icon-24-preview.png")), { recursive: true });
writeFileSync(resolve(repo, "brand/pinpoint-icon-24-preview.png"), preview);

console.log(`icon-24.png: ${icon.length} bytes, 24x24`);
console.log(`pinpoint-icon-24-preview.png: ${preview.length} bytes, 96x96 (4x)`);
