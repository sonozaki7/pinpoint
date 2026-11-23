#!/usr/bin/env node
// Copy the real simulator recordings into the film and rebuild the ring-gesture
// inputs from each recording's timeline. The timelines are the source of truth:
// an input that is not in the timeline must not appear in the film.
//
//   node scripts/sync-recordings.mjs
//
// The mp4s stay in demo/recordings/ (git-ignored scratch); the film keeps its
// own copy under public/clips/ so a render never depends on the scratch folder.

import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const film = resolve(here, "..");
const demo = resolve(film, "..");
const recordings = join(demo, "recordings");
const clipsDir = join(film, "public/clips");
const clipsPath = join(film, "src/clips.json");

mkdirSync(clipsDir, {recursive: true});

const CLIPS = ["live-hero.mp4", "deps.mp4", "inbox.mp4", "inbox-after.mp4", "inbox-morning.mp4"];
for (const name of CLIPS) {
  const from = join(recordings, name);
  if (!existsSync(from)) throw new Error(`missing recording: ${from}`);
  copyFileSync(from, join(clipsDir, name));
}

const proofFrom = join(recordings, "t3-live-thread.json");
const proofTo = join(film, "src/pinpoint/fixtures/t3-live-thread.json");
copyFileSync(proofFrom, proofTo);

const clips = JSON.parse(readFileSync(clipsPath, "utf8"));

const HERO_LABELS = {
  "open auth-refresh-fix": "open the plan",
  "point 2": "next point",
  "point 3": "next point",
  "point 4, high risk": "to step 4",
  "tap to stop": "stop recording",
  "point 5": "next point",
  "point 6, mutex": "to step 6",
  "point 7": "next point",
  "Send review row": "to the send row",
  "open preview": "open preview",
  "send to agent": "send the review",
};

const QUESTION_LABELS = {
  "open deps-upgrade": "open deps-upgrade",
  "open options": "open options",
  "pick Stay on 6 for now": "pick Stay on 6",
  "back to inbox": "back to inbox",
};

const INBOX_LABELS = {
  "row 2": "to row 2",
  "row 3 inbox-morning": "to inbox-morning",
  "open inbox-morning": "open inbox-morning",
  "draft 1, Priya": "draft 1 · Priya",
  "draft 2, Tomas": "draft 2 · Tomas",
  "tap to stop": "stop recording",
  "draft 3, Cassie": "draft 3 · Cassie",
  "draft 4, Airbnb": "draft 4 · Airbnb",
  "last point": "last point",
  "Send review row": "send row",
  "back to inbox": "back to inbox",
};

const kindFor = (action, label) => {
  if (action === "double_click") return "double";
  if (action === "click") return /^tap to record/.test(label) ? "talk" : "tap";
  return "swipe";
};

const labelFor = (scene, label) => {
  if (label.startsWith("tap to record:")) return "start voice";
  const map = scene === "hero" ? HERO_LABELS : scene === "question" ? QUESTION_LABELS : scene === "inbox" ? INBOX_LABELS : {};
  return map[label] ?? label;
};

const SCENES = [
  {scene: "alert", timeline: "inbox.timeline.json", clip: "inbox.mp4"},
  {scene: "hero", timeline: "live-hero.timeline.json", clip: "live-hero.mp4"},
  {scene: "question", timeline: "deps.timeline.json", clip: "deps.mp4"},
  {scene: "inbox", timeline: "inbox-morning.timeline.json", clip: "inbox-morning.mp4"},
];

for (const entry of SCENES) {
  const timeline = JSON.parse(readFileSync(join(recordings, entry.timeline), "utf8"));
  const delay = Number(clips.scenes?.[entry.scene]?.source?.delay ?? 0);
  const inputs = (timeline.inputs ?? []).map((input) => ({
    at: Number(((input.sceneMs ?? 0) / 1000 + delay).toFixed(3)),
    kind: kindFor(input.action, input.label),
    label: labelFor(entry.scene, input.label),
    note: input.action,
    sourceLabel: input.label,
  }));
  if (!clips.scenes[entry.scene]) throw new Error(`clips.json has no ${entry.scene} scene`);
  clips.scenes[entry.scene].inputs = inputs;
  clips.scenes[entry.scene].recording = {
    clip: `clips/${entry.clip}`,
    timeline: `demo/recordings/${entry.timeline}`,
    duration: timeline.video?.durationSec ?? timeline.durationMs / 1000,
    fps: timeline.fps,
    frames: timeline.frames,
    inputs: inputs.length,
    note: "inputs are generated from the recording timeline by scripts/sync-recordings.mjs",
  };
  console.log(`${entry.scene.padEnd(9)} ${entry.clip.padEnd(18)} ${inputs.length} inputs · ${timeline.video?.durationSec ?? "?"}s`);
}

writeFileSync(clipsPath, JSON.stringify(clips, null, 2) + "\n");
console.log(`\nupdated ${clipsPath}`);
console.log(`synced ${CLIPS.length} clips → public/clips, proof export → src/pinpoint/fixtures/t3-live-thread.json`);
