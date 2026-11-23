#!/usr/bin/env node
// Remotion only serves assets inside public/, and the fixture text is the source
// of truth for the hook wall and the inbox board. Copy both into the film.
//
//   node scripts/sync-shots.mjs

import {copyFileSync, mkdirSync, readdirSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const demo = resolve(film, "..");

const shots = join(demo, "shots");
const shotOut = join(film, "public/shots");
mkdirSync(shotOut, {recursive: true});
let shotsCopied = 0;
for (const name of readdirSync(shots)) {
  if (!/^glasses-.*\.png$/.test(name)) continue;
  copyFileSync(join(shots, name), join(shotOut, name));
  shotsCopied += 1;
}

const fixtures = join(demo, "fixtures");
const fixtureOut = join(film, "src/pinpoint/fixtures");
mkdirSync(fixtureOut, {recursive: true});
let fixturesCopied = 0;
for (const name of readdirSync(fixtures)) {
  if (!name.endsWith(".json")) continue;
  copyFileSync(join(fixtures, name), join(fixtureOut, name));
  fixturesCopied += 1;
}

console.log(`synced ${shotsCopied} simulator stills → public/shots`);
console.log(`synced ${fixturesCopied} fixtures → src/pinpoint/fixtures`);
for (const name of readdirSync(shotOut)) {
  const size = statSync(join(shotOut, name)).size;
  console.log(`  ${name.padEnd(32)} ${(size / 1024).toFixed(1)} kB`);
}
