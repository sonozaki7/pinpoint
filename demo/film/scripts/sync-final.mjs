#!/usr/bin/env node
// Copies the final glasses recordings (demo/recordings/final-*.mp4 + timelines) into the film and
// writes src/pinpoint-final/layout.generated.json from plan.json:
//   - each segment is a cut of a recording between two timeline marks (+ offsets), played at `rate`
//   - scene length = last segment end + tail; scenes chain (walk -> everyday -> proof -> close)
//   - every recording mark becomes a global film time, so narration and overlays follow the footage
//   node scripts/sync-final.mjs [recordingsDir]
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const rec = resolve(process.argv[2] ?? join(film, "../recordings"));
const final = join(film, "src/pinpoint-final");
mkdirSync(join(final, "footage"), {recursive: true});
mkdirSync(join(film, "public/clips"), {recursive: true});

const plan = JSON.parse(readFileSync(join(final, "plan.json"), "utf8"));
const layout = {scenes: {}, marks: {}};
const r3 = (n) => Number(n.toFixed(3));
let cursor = plan.hookEnd; // end of the intro; first footage scene starts here

for (const [sceneId, scene] of Object.entries(plan.footage)) {
  const name = scene.clip;
  const mp4 = join(rec, `final-${name}.mp4`);
  const tlFile = join(rec, `final-${name}.timeline.json`);
  if (!existsSync(mp4) || !existsSync(tlFile)) throw new Error(`missing recording final-${name}`);
  copyFileSync(mp4, join(film, "public/clips", `final-${name}.mp4`));
  copyFileSync(tlFile, join(final, "footage", `final-${name}.timeline.json`));
  const tl = JSON.parse(readFileSync(tlFile, "utf8"));
  const markT = (label) => {
    const m = tl.marks.find((x) => x.label === label);
    if (!m) throw new Error(`${name}: no mark "${label}"`);
    return m.t / 1000;
  };
  const start = cursor;
  const segs = [];
  let local = 0;
  for (const s of scene.segs) {
    const at = s.at ?? local + (s.gap ?? 0);
    const from = markT(s.from) + (s.fromOff ?? 0);
    const to = markT(s.to) + (s.toOff ?? 0);
    const rate = s.rate ?? 1;
    const dur = (to - from) / rate;
    local = at + dur;
    segs.push({id: s.id, src: `clips/final-${name}.mp4`, at: r3(at), dur: r3(dur), from: r3(from), rate});
    for (const m of tl.marks) {
      const t = m.t / 1000;
      const key = `${sceneId}.${m.label}`;
      if (t >= from - 1e-6 && t <= to + 1e-6 && !(key in layout.marks)) layout.marks[key] = r3(start + at + (t - from) / rate);
    }
  }
  const end = r3(start + local + (scene.tail ?? 1));
  layout.scenes[sceneId] = {start: r3(start), end, segs};
  cursor = end;
}
for (const [id, len] of Object.entries(plan.after)) {
  layout.scenes[id] = {start: r3(cursor), end: r3(cursor + len)};
  cursor += len;
}
layout.scenes.hook = {start: 0, end: plan.hookEnd};
layout.total = r3(cursor);
writeFileSync(join(final, "layout.generated.json"), JSON.stringify(layout, null, 1));
console.log(`layout: ${Object.keys(layout.marks).length} marks, total ${layout.total} s`);
for (const [id, s] of Object.entries(layout.scenes)) console.log(`  ${id.padEnd(9)} ${s.start.toFixed(1).padStart(6)} → ${s.end.toFixed(1).padStart(6)}`);
