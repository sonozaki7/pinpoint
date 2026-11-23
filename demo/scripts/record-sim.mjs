#!/usr/bin/env node
// Records the Pinpoint demo hero sequence by driving the official Even Hub
// simulator automation API (https://hub.evenrealities.com/docs/test/simulator):
//
//   GET  /api/ping                 readiness
//   GET  /api/console              app log lines (readiness signal)
//   GET  /api/screenshot/glasses   576x288 RGBA PNG of the framebuffer
//   POST /api/input                { action: up|down|click|double_click|
//                                    long_press|long_press_release|context_menu }
//
// Frames land in demo/shots/tmp/<scene>/00001.png ... at ~10 fps, next to
// timeline.json (every input with timestamps) and markers.json (cut points for
// the video editor). Frames are green-on-transparent, so frames-to-mp4.sh
// composites them on black.
//
// It never kills a simulator it did not start. With `--launch` and a port that
// already answers /api/ping, the running simulator is reused instead of
// launching a second one. `--mock` starts a local fake control plane so the
// whole pipeline can be tested without a simulator; `--dry-run` only prints the
// planned pacing.
//
// Usage:
//   node demo/scripts/record-sim.mjs --port 9898            # use a running simulator
//   node demo/scripts/record-sim.mjs --launch               # start one on 9898, then record
//   node demo/scripts/record-sim.mjs --launch --port 9917   # own port, coexists with another agent
//   node demo/scripts/record-sim.mjs --mock --out demo/shots/tmp/mock
//   node demo/scripts/record-sim.mjs --dry-run --list

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const execFileP = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
function value(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : fallback;
}
function numeric(name, fallback) {
  const raw = value(name, undefined);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`${name} needs a non-negative number, got "${raw}"`);
    process.exit(2);
  }
  return parsed;
}

const envPort = Number(process.env.PINPOINT_SIM_PORT ?? "");

const options = {
  port: numeric("--port", Number.isInteger(envPort) && envPort > 1024 ? envPort : 9898),
  url: value("--url", process.env.PINPOINT_GLASSES_URL ?? "http://127.0.0.1:5173"),
  launch: has("--launch"),
  simBin: value("--sim-bin", join(repo, "apps/glasses/node_modules/@evenrealities/evenhub-simulator/bin/index.js")),
  scenes: value("--scenes", "inbox,auth,inbox-after,deps,inbox-morning").split(",").map((scene) => scene.trim()).filter(Boolean),
  out: resolve(repo, value("--out", "demo/shots/tmp")),
  recordings: resolve(repo, value("--recordings", "demo/recordings")),
  recordName: value("--record-name", ""),
  encode: !has("--no-encode"),
  sheet: !has("--no-sheet"),
  captureMs: numeric("--capture-ms", 100),
  stepMs: numeric("--step-ms", 700),
  voiceMs: numeric("--voice-ms", 2600),
  voiceStopMs: numeric("--voice-stop-ms", 2000),
  readyMs: numeric("--ready-ms", 15000),
  readyPattern: value("--ready-pattern", "pinpoint|ready"),
  dryRun: has("--dry-run"),
  mock: has("--mock"),
  capture: !has("--no-capture"),
  strict: has("--strict"),
  list: has("--list"),
  help: has("--help") || has("-h"),
};

const log = (...parts) => console.log(...parts);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ------------------------------------------------------------------- scenes

// Hero sequence from docs/DEMO.md:
//   inbox (before) -> auth-refresh-fix (notes on 4 and 6, preview, send)
//   -> inbox (after, thread gone) -> deps-upgrade (one tap on an option)
//   -> inbox-morning (one correction on the Tuesday draft).
// Assumes the visible order of SPEC §5 (question, plan, failed, report): inbox
// row 1 is deps-upgrade, row 2 auth-refresh-fix, row 4 inbox-morning before the
// send; after the send auth is hidden, so inbox-morning is row 3 (row 1 deps,
// row 2 flaky-e2e).
const NOTE_POINT4 = "No. Don't log everyone out. Migrate the existing sessions instead.";
const NOTE_POINT6 = "Use a request queue. A mutex deadlocks with the retry path.";
const NOTE_MORNING = "Make it Thursday, not Tuesday.";

const SCENES = [
  {
    id: "inbox",
    title: "Inbox before the review",
    steps: [
      { wait: 600, label: "settle after boot" },
      { mark: "inbox:first-frame" },
      { action: "down", label: "focus auth-refresh-fix", hold: 900 },
      { mark: "inbox:auth-focused" },
      { wait: 1200, label: "hold on the list" },
    ],
  },
  {
    id: "auth",
    title: "auth-refresh-fix: review a 7-step plan",
    steps: [
      { action: "click", label: "open auth-refresh-fix", hold: 1400 },
      { mark: "auth:deck" },
      { wait: 700, label: "read point 1" },
      { action: "down", label: "point 2", hold: 900 },
      { action: "down", label: "point 3", hold: 900 },
      // Human beat: let the risky step 4 quote sit on screen for a read.
      { action: "down", label: "point 4, high risk", hold: 1500 },
      { mark: "auth:point4" },
      { note: NOTE_POINT4 },
      { mark: "auth:point4-objected" },
      { action: "down", label: "point 5", hold: 900 },
      { action: "down", label: "point 6, mutex", hold: 1200 },
      { mark: "auth:point6" },
      { note: NOTE_POINT6 },
      { mark: "auth:point6-noted" },
      { action: "down", label: "point 7", hold: 900 },
      { action: "down", label: "Send review row", hold: 1100 },
      { mark: "auth:send-row" },
      { action: "click", label: "open preview", hold: 1600 },
      { mark: "auth:preview" },
      { action: "click", label: "send to agent", hold: 1600 },
      { mark: "auth:sent" },
      { wait: 900, label: "Sent to agent toast, then back to inbox" },
    ],
  },
  {
    id: "inbox-after",
    title: "Inbox after the send: the thread is gone",
    steps: [
      { mark: "inbox-after:first-frame" },
      { wait: 2000, label: "hold the three-thread inbox" },
    ],
  },
  {
    id: "deps",
    title: "deps-upgrade: answer a question with one tap",
    steps: [
      { wait: 700, label: "back at inbox" },
      { mark: "deps:inbox" },
      { action: "click", label: "open deps-upgrade", hold: 1400 },
      { mark: "deps:question" },
      { wait: 900, label: "read the question" },
      { action: "click", label: "open options", hold: 1400 },
      { mark: "deps:options" },
      { wait: 800, label: "read the options" },
      { action: "click", label: "pick Stay on 6 for now", hold: 1800 },
      { mark: "deps:answered" },
      { action: "double_click", label: "back to inbox", hold: 1200 },
    ],
  },
  {
    id: "inbox-morning",
    title: "inbox-morning: 4 drafted replies",
    steps: [
      { wait: 700, label: "back at inbox" },
      { mark: "morning:inbox" },
      { action: "down", label: "row 2", hold: 900 },
      { action: "down", label: "row 3 inbox-morning", hold: 900 },
      { action: "click", label: "open inbox-morning", hold: 1400 },
      { mark: "morning:deck" },
      { wait: 700, label: "read the summary" },
      { action: "down", label: "draft 1, Priya", hold: 900 },
      { action: "down", label: "draft 2, Tomas", hold: 1200 },
      { mark: "morning:tomas-draft" },
      { note: NOTE_MORNING },
      { mark: "morning:corrected" },
      { action: "down", label: "draft 3, Cassie", hold: 900 },
      { action: "down", label: "draft 4, Airbnb", hold: 900 },
      { action: "down", label: "last point", hold: 900 },
      { action: "down", label: "Send review row", hold: 1100 },
      { mark: "morning:send-row" },
      { action: "double_click", label: "back to inbox", hold: 1000 },
    ],
  },
];

const SCENES_HINT = SCENES.map((scene) => scene.id).join(", ");

if (options.help) {
  log(`record-sim.mjs — drive the Even Hub simulator and capture demo frames

  --port <n>            automation port (default 9898, env PINPOINT_SIM_PORT)
  --url <url>           app URL used only with --launch (default http://127.0.0.1:5173)
  --launch              start an own simulator on --port unless one already answers
  --scenes <list>       comma list of: ${SCENES_HINT}
  --out <dir>           output root (default demo/shots/tmp)
  --recordings <dir>    mp4 + timeline + contact sheet folder (default demo/recordings)
  --record-name <name>  output name for a single-scene run (e.g. live-hero)
  --no-encode           keep frames + timelines, skip mp4 and contact sheets
  --no-sheet            skip the contact sheet PNG
  --capture-ms <n>      frame cadence (default 100)
  --step-ms <n>         hold after each input (default 700)
  --voice-ms <n>        simulated voice-note length (default 2600)
  --voice-stop-ms <n>   wait after stopping the mic for the transcript to land (default 2000)
  --ready-ms <n>        how long to wait for the app-ready log line (default 15000)
  --ready-pattern <re>  regex for the ready log line (default "pinpoint|ready")
  --no-capture          send inputs, skip frames
  --mock                local fake control plane (pipeline test, no simulator)
  --dry-run             print the plan and a planning timeline, send nothing
  --strict              abort on the first failed input
  --list                print scenes and their planned duration
  --help`);
  process.exit(0);
}

function expand(steps, { voiceMs, voiceStopMs, stepMs }) {
  const expanded = [];
  for (const step of steps) {
    if (step.note) {
      expanded.push({ type: "input", action: "click", label: `tap to record: ${step.note}`, hold: 0 });
      expanded.push({ type: "wait", ms: voiceMs, label: "speaking" });
      // The transcript arrives after the server's delay; wait for it before the
      // next swipe, or the note lands on the point the user has swiped to.
      expanded.push({ type: "input", action: "click", label: "tap to stop", hold: voiceStopMs });
      expanded.push({ type: "transcript", label: step.note });
    } else if (step.action) {
      expanded.push({ type: "input", action: step.action, label: step.label ?? step.action, hold: step.hold ?? stepMs });
    } else if (step.wait !== undefined) {
      expanded.push({ type: "wait", ms: step.wait, label: step.label ?? "wait" });
    } else if (step.mark) {
      expanded.push({ type: "mark", label: step.mark });
    }
  }
  return expanded;
}

const plannedDuration = (scene, paced) =>
  expand(scene.steps, paced).reduce((sum, step) => sum + (step.hold ?? step.ms ?? 0), 0);

const selected = options.scenes.map((id) => {
  const scene = SCENES.find((candidate) => candidate.id === id);
  if (!scene) {
    console.error(`unknown scene "${id}" (known: ${SCENES_HINT})`);
    process.exit(2);
  }
  return scene;
});

if (options.recordName && selected.length !== 1) {
  console.error(`--record-name needs exactly one scene, got ${selected.length}`);
  process.exit(2);
}

const pacing = { voiceMs: options.voiceMs, voiceStopMs: options.voiceStopMs, stepMs: options.stepMs };

if (options.list) {
  for (const scene of selected) {
    const seconds = (plannedDuration(scene, pacing) / 1000).toFixed(1);
    log(`${scene.id.padEnd(14)} ${seconds.padStart(5)} s  ${scene.title}`);
  }
  const total = selected.reduce((sum, scene) => sum + plannedDuration(scene, pacing), 0);
  log(`${"total".padEnd(14)} ${(total / 1000).toFixed(1).padStart(5)} s`);
  process.exit(0);
}

// ------------------------------------------------------------- http helpers

const baseUrl = () => `http://127.0.0.1:${options.port}`;

async function request(path, { method = "GET", body, timeout = 3000 } = {}) {
  const response = await fetch(baseUrl() + path, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response;
}

async function ping(timeout = 1000) {
  try {
    const response = await request("/api/ping", { timeout });
    return (await response.text()).trim() === "pong";
  } catch {
    return false;
  }
}

async function screenshot() {
  const response = await request("/api/screenshot/glasses", { timeout: 6000 });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("screenshot is not a PNG");
  }
  return bytes;
}

async function waitForReady() {
  if (!(await ping())) return false;
  const deadline = Date.now() + options.readyMs;
  const pattern = new RegExp(options.readyPattern, "i");
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const { entries = [] } = await (await request("/api/console", { timeout: 2000 })).json();
      if (entries.some((entry) => pattern.test(String(entry?.message ?? "")))) {
        ready = true;
        break;
      }
    } catch {
      // older simulators may not expose /api/console; fall through to the timeout
    }
    await sleep(250);
  }
  if (!ready) {
    log(`  ! no ready log line matching /${options.readyPattern}/ after ${options.readyMs} ms; continuing (input before the first event-capturing container is dropped silently)`);
  }
  return true;
}

// -------------------------------------------------------- mock control plane

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// A wireframe stand-in for the glasses UI: header, row bars, focused row
// brighter, footer. Only used by --mock to exercise capture and encoding.
function mockFrame(width, height, { screen, focus, rows, cursor }) {
  const rgba = Buffer.alloc(width * height * 4);
  const bar = (x, y, w, h, alpha) => {
    for (let py = y; py < Math.min(height, y + h); py += 1) {
      for (let px = x; px < Math.min(width, x + w); px += 1) {
        const i = (py * width + px) * 4;
        rgba[i] = 0;
        rgba[i + 1] = 255;
        rgba[i + 2] = 0;
        rgba[i + 3] = alpha;
      }
    }
  };
  bar(24, 16, 300, 14, 230); // header
  bar(24, 44, 180, 8, 120); // subtitle
  for (let row = 0; row < rows; row += 1) {
    const y = 86 + row * 34;
    const active = row === focus;
    bar(24, y, 60 + ((row * 83) % 300), 12, active ? 255 : 90);
    if (active) bar(24, y + 16, 420, 4, 160);
  }
  if (screen === "review") bar(24, 236, 500, 3, 70); // divider
  bar(24, 252, 120 + cursor * 40, 10, 200); // footer / counter
  return encodePng(width, height, rgba);
}

function startMockControlPlane() {
  const state = { screen: "inbox", focus: 0, rows: 4, cursor: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/ping") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("pong");
    }
    if (url.pathname === "/api/console") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ total: 2, entries: [
        { id: 1, level: "info", message: "[pinpoint] boot" },
        { id: 2, level: "info", message: "[pinpoint] ready" },
      ] }));
    }
    if (url.pathname === "/api/screenshot/glasses") {
      const png = mockFrame(576, 288, state);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length });
      return res.end(png);
    }
    if (url.pathname === "/api/input" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const { action } = JSON.parse(body || "{}");
        state.cursor = (state.cursor + 1) % 6;
        if (action === "click") {
          state.screen = state.screen === "inbox" ? "review" : state.screen === "review" ? "preview" : "inbox";
          state.focus = 0;
        } else if (action === "double_click") {
          state.screen = "inbox";
          state.focus = 0;
        } else if (action === "down") {
          state.focus = Math.min(state.rows - 1, state.focus + 1);
        } else if (action === "up") {
          state.focus = Math.max(0, state.focus - 1);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, action, screen: state.screen, focus: state.focus }));
      });
      return undefined;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("not found");
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({ server, port: server.address().port });
    });
  });
}

// ------------------------------------------------------------------ recorder

const startedAt = Date.now();
const events = [];
const frames = [];
const markers = [];
const sceneSummaries = [];

let currentScene = "";
let sceneStart = 0;
let sceneStartWall = 0;
let virtualMs = 0;
let captureRunning = false;
let captureTask = null;
let lastFrame = { index: 0, hash: "" };

// In dry-run the clock is virtual (no sleeping); otherwise it is wall clock.
const clock = () => (options.dryRun ? virtualMs : Date.now() - startedAt);
const sceneMs = () => clock() - sceneStart;

async function tick(ms) {
  if (ms <= 0) return;
  if (options.dryRun) {
    virtualMs += ms;
    return;
  }
  await sleep(ms);
}

async function send(action) {
  const response = await request("/api/input", { method: "POST", body: { action }, timeout: 8000 });
  return response.json().catch(() => ({}));
}

function startCapture(sceneId) {
  if (!options.capture) return;
  const dir = join(options.out, sceneId);
  mkdirSync(dir, { recursive: true });
  captureRunning = true;
  captureTask = (async () => {
    let index = 0;
    while (captureRunning) {
      const tickStart = Date.now();
      try {
        const png = await screenshot();
        index += 1;
        writeFileSync(join(dir, `${String(index).padStart(5, "0")}.png`), png);
        const hash = createHash("sha1").update(png).digest("hex").slice(0, 12);
        lastFrame = { index, hash };
        frames.push({ scene: sceneId, i: index, t: clock(), sceneMs: sceneMs(), hash });
      } catch (error) {
        events.push({ t: clock(), scene: sceneId, type: "warn", label: `screenshot failed: ${error.message}` });
      }
      const spent = Date.now() - tickStart;
      if (captureRunning) await sleep(Math.max(0, options.captureMs - spent));
    }
    return index;
  })();
}

async function stopCapture() {
  if (!captureTask) return 0;
  captureRunning = false;
  const count = await captureTask;
  captureTask = null;
  return count;
}

async function runScenes() {
  for (const scene of selected) {
    currentScene = scene.id;
    sceneStart = clock();
    sceneStartWall = Date.now();
    rmSync(join(options.out, scene.id), { recursive: true, force: true });
    events.push({ t: clock(), scene: scene.id, type: "scene-start", label: scene.title });
    if (!options.dryRun) startCapture(scene.id);
    log(`\n${scene.id} — ${scene.title}`);

    for (const step of expand(scene.steps, pacing)) {
      if (step.type === "mark") {
        markers.push({ scene: scene.id, label: step.label, sceneMs: sceneMs(), frame: lastFrame.index, t: clock() });
        events.push({ t: clock(), scene: scene.id, type: "mark", label: step.label, frame: lastFrame.index });
        log(`  mark ${step.label}`);
        continue;
      }
      if (step.type === "wait") {
        events.push({ t: clock(), scene: scene.id, type: "wait", ms: step.ms, label: step.label });
        log(`  ..   ${step.ms} ms  ${step.label}`);
        await tick(step.ms);
        continue;
      }
      if (step.type === "transcript") {
        events.push({ t: clock(), scene: scene.id, type: "transcript", label: step.label });
        log(`  say  "${step.label}"`);
        continue;
      }

      const event = {
        t: clock(), scene: scene.id, type: "input", action: step.action,
        label: step.label, frameBefore: lastFrame.index, sceneMs: sceneMs(),
      };
      events.push(event);
      let failed = false;
      if (!options.dryRun) {
        try {
          event.response = await send(step.action);
        } catch (error) {
          failed = true;
          events.push({ t: clock(), scene: scene.id, type: "warn", label: `${step.action} failed: ${error.message}` });
          log(`  !!   ${step.action} failed: ${error.message}`);
          if (options.strict) throw error;
        }
      }
      log(`  ${failed ? "!!" : "in"}   ${step.action}${step.label && step.label !== step.action ? `  (${step.label})` : ""}`);
      await tick(step.hold);
      event.frameAfter = lastFrame.index;
      // Inputs with no hold have no time to capture a new frame; skip the check.
      const canVerify = !failed && !options.dryRun && options.capture && step.hold >= options.captureMs * 3;
      if (canVerify && lastFrame.index <= event.frameBefore) {
        log("  !!   framebuffer did not advance after this input (wrong focused row or dropped input?)");
      }
    }

    const frameCount = await stopCapture();
    const durationMs = options.dryRun ? sceneMs() : Date.now() - sceneStartWall;
    sceneSummaries.push({
      id: scene.id,
      title: scene.title,
      durationMs,
      frames: options.capture ? frameCount : 0,
      fps: options.capture && durationMs > 0 ? Number(((frameCount / durationMs) * 1000).toFixed(2)) : 0,
      inputs: events.filter((event) => event.scene === scene.id && event.type === "input").length,
    });
    events.push({ t: clock(), scene: scene.id, type: "scene-end" });
    log(`  done ${scene.id}: ${(durationMs / 1000).toFixed(1)} s, ${frameCount ?? 0} frames`);
  }
}

function writeArtifacts() {
  const mode = options.dryRun ? "dry-run" : options.mock ? "mock" : "simulator";
  writeFileSync(join(options.out, "timeline.json"), JSON.stringify({
    tool: "evenhub-simulator automation API",
    mode,
    port: mode === "simulator" ? options.port : null,
    viewport: { width: 576, height: 288, format: "RGBA PNG, green text on transparent" },
    captureMs: options.captureMs,
    pacing,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    totalMs: clock(),
    scenes: sceneSummaries,
    events,
    frames,
  }, null, 2) + "\n");

  writeFileSync(join(options.out, "markers.json"), JSON.stringify({
    note: "Cut points per scene. sceneMs counts from that scene's first frame; frame is the 1-based PNG inside <scene>/.",
    scenes: sceneSummaries.map((scene) => ({
      id: scene.id,
      title: scene.title,
      durationMs: scene.durationMs,
      fps: scene.fps,
      markers: markers.filter((marker) => marker.scene === scene.id),
    })),
  }, null, 2) + "\n");

  if (options.dryRun || !options.capture) return;
  for (const scene of sceneSummaries) {
    writeFileSync(join(options.out, scene.id, "meta.json"), JSON.stringify({
      scene: scene.id,
      title: scene.title,
      frames: scene.frames,
      durationMs: scene.durationMs,
      fps: scene.fps,
      captureMs: options.captureMs,
      mode,
      recordedAt: new Date(startedAt).toISOString(),
    }, null, 2) + "\n");
  }
}

// --------------------------------------------------------------- clip output

function fractionToNumber(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(den) || den === 0) return num;
  return Number((num / den).toFixed(3));
}

async function probeMp4(file) {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    file,
  ], { maxBuffer: 1 << 20 });
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const durationSec = Number(parsed.format?.duration ?? stream.duration ?? 0);
  return {
    width: stream.width ?? null,
    height: stream.height ?? null,
    fps: fractionToNumber(stream.avg_frame_rate ?? stream.r_frame_rate),
    durationSec: Number.isFinite(durationSec) ? Number(durationSec.toFixed(3)) : null,
  };
}

async function encodeScene(scene, name) {
  const sceneMp4 = join(options.recordings, `${scene.id}.mp4`);
  const mp4 = join(options.recordings, `${name}.mp4`);
  await execFileP("bash", [
    join(here, "frames-to-mp4.sh"),
    "--root", options.out,
    "--out", options.recordings,
    "--scene", scene.id,
  ], { maxBuffer: 8 << 20 });
  if (mp4 !== sceneMp4) renameSync(sceneMp4, mp4);
  const video = await probeMp4(mp4);
  return { mp4, video };
}

/** One green-on-black 4x3 contact sheet, twelve frames spread across the scene. */
async function contactSheet(scene, name) {
  const file = join(options.recordings, `${name}-sheet.png`);
  const rate = scene.fps || 10;
  const step = Math.max(1, Math.round((scene.frames || 1) / 12));
  await execFileP("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(rate), "-start_number", "1", "-i", join(options.out, scene.id, "%05d.png"),
    "-f", "lavfi", "-i", `color=c=black:s=576x288:r=${rate}`,
    "-filter_complex",
    `[0:v]format=rgba[fg];[1:v][fg]overlay=shortest=1:format=auto,select='not(mod(n\\,${step}))',scale=288:144:flags=neighbor,tile=4x3:padding=4:color=black[out]`,
    "-map", "[out]", "-frames:v", "1", file,
  ], { maxBuffer: 4 << 20 });
  return file;
}

function sceneTimeline(scene, extra = {}, name = scene.id) {
  const sceneEvents = events.filter((event) => event.scene === scene.id);
  const inputs = sceneEvents
    .filter((event) => event.type === "input")
    .map((event) => ({
      t: event.t,
      sceneMs: event.sceneMs,
      action: event.action,
      label: event.label,
      frameBefore: event.frameBefore,
      frameAfter: event.frameAfter,
      ...(event.response ? { response: event.response } : {}),
    }));
  return {
    scene: name,
    ...(name !== scene.id ? { sourceScene: scene.id } : {}),
    title: scene.title,
    source: "evenhub-simulator automation API",
    viewport: { width: 576, height: 288, format: "RGBA PNG, green text on transparent" },
    captureMs: options.captureMs,
    pacing,
    durationMs: scene.durationMs,
    frames: scene.frames,
    fps: scene.fps,
    recordedAt: new Date(startedAt).toISOString(),
    markers: markers.filter((marker) => marker.scene === scene.id),
    inputs,
    transcripts: sceneEvents.filter((event) => event.type === "transcript").map((event) => ({
      t: event.t,
      sceneMs: event.sceneMs,
      text: event.label,
    })),
    events: sceneEvents,
    ...extra,
  };
}

/** Encode, probe and sheet every captured scene; writes <scene>.timeline.json. */
async function produceRecordings() {
  mkdirSync(options.recordings, { recursive: true });
  const outputs = [];
  const manifest = [];
  for (const scene of sceneSummaries) {
    const name = options.recordName || scene.id;
    let video = null;
    let mp4 = null;
    let sheet = null;
    if (options.encode) {
      try {
        ({ mp4, video } = await encodeScene(scene, name));
        log(`  clip ${name}.mp4  ${video.width}x${video.height} ${video.fps} fps ${video.durationSec}s`);
      } catch (error) {
        log(`  !! could not encode ${name}: ${error.message}`);
      }
      if (options.sheet && mp4) {
        try {
          sheet = await contactSheet(scene, name);
          log(`  sheet ${name}-sheet.png`);
        } catch (error) {
          log(`  !! could not build the ${name} contact sheet: ${error.message}`);
        }
      }
    }
    const timelineFile = join(options.recordings, `${name}.timeline.json`);
    const timeline = sceneTimeline(scene, {
      ...(mp4 ? { video: { file: mp4, ...video } } : {}),
      ...(sheet ? { sheet } : {}),
    }, name);
    writeFileSync(timelineFile, JSON.stringify(timeline, null, 2) + "\n");
    outputs.push({ ...scene, name, mp4, sheet, timeline: timelineFile, video });
    manifest.push({
      id: name,
      ...(name !== scene.id ? { sourceScene: scene.id } : {}),
      title: scene.title,
      durationMs: scene.durationMs,
      frames: scene.frames,
      fps: scene.fps,
      mp4,
      sheet,
      video,
    });
  }
  writeFileSync(join(options.recordings, "scenes.json"), JSON.stringify({
    recordedAt: new Date(startedAt).toISOString(),
    mode: "simulator",
    recordings: mergeManifest(manifest),
  }, null, 2) + "\n");
  return outputs;
}

/** Keep earlier clips in scenes.json when a later run records only one scene. */
function mergeManifest(fresh) {
  const file = join(options.recordings, "scenes.json");
  const earlier = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(parsed.recordings)) earlier.push(...parsed.recordings);
  } catch {
    // first run in this folder
  }
  const freshIds = new Set(fresh.map((entry) => entry.id));
  const merged = new Map(earlier.filter((entry) => entry?.id && !freshIds.has(entry.id)).map((entry) => [entry.id, entry]));
  for (const entry of fresh) merged.set(entry.id, entry);
  return [...merged.values()];
}


function printPlan() {
  log(`mode: ${options.dryRun ? "dry-run" : options.mock ? "mock" : `simulator on 127.0.0.1:${options.port}`}`);
  log(`out:  ${options.out}`);
  if (!options.dryRun && !options.mock) log(`clips: ${options.recordings}`);
  log(`capture: ${options.capture ? `every ${options.captureMs} ms` : "off"}   step: ${options.stepMs} ms   voice: ${options.voiceMs} ms\n`);
  for (const scene of selected) {
    const steps = expand(scene.steps, pacing);
    const inputs = steps.filter((step) => step.type === "input").length;
    const seconds = (plannedDuration(scene, pacing) / 1000).toFixed(1);
    log(`${scene.id.padEnd(14)} ${seconds.padStart(5)} s  ${String(inputs).padStart(2)} inputs  ${steps.filter((step) => step.type === "mark").length} marks  ${scene.title}`);
  }
}

// --------------------------------------------------------------------- main

async function main() {
  printPlan();

  let mock = null;
  let launched = null;

  if (options.dryRun) {
    log("\ndry run: nothing is sent, no frames are captured");
    rmSync(join(options.out, "timeline.json"), { force: true });
    rmSync(join(options.out, "markers.json"), { force: true });
    mkdirSync(options.out, { recursive: true });
  } else if (options.mock) {
    mock = await startMockControlPlane();
    options.port = mock.port;
    rmSync(options.out, { recursive: true, force: true });
    mkdirSync(options.out, { recursive: true });
    log(`\nmock control plane on 127.0.0.1:${mock.port}`);
  } else {
    if (options.launch && (await ping(800))) {
      log(`\nsimulator already answering on 127.0.0.1:${options.port}; reusing it (not launching another)`);
    } else if (options.launch) {
      log(`\nlaunching own simulator: ${options.url} --automation-port ${options.port}`);
      launched = spawn(process.execPath, [options.simBin, options.url, "--automation-port", String(options.port)], {
        cwd: dirname(options.simBin),
        stdio: ["ignore", "pipe", "pipe"],
      });
      launched.stdout.on("data", (chunk) => process.stdout.write(`  sim| ${chunk}`));
      launched.stderr.on("data", (chunk) => process.stderr.write(`  sim| ${chunk}`));
      launched.on("exit", (code) => log(`  sim exited with ${code}`));
    }
    if (!(await waitForReady())) {
      console.error(`\nno simulator automation API on 127.0.0.1:${options.port}.`);
      console.error("Start one with: node apps/glasses/node_modules/@evenrealities/evenhub-simulator/bin/index.js <app url> --automation-port 9898");
      console.error("or pass --launch (own port, e.g. --launch --port 9917), or test with --mock / --dry-run.");
      launched?.kill("SIGTERM");
      process.exit(1);
    }
    mkdirSync(options.out, { recursive: true });
    rmSync(join(options.out, "timeline.json"), { force: true });
    rmSync(join(options.out, "markers.json"), { force: true });
  }

  try {
    await runScenes();
    writeArtifacts();
  } finally {
    if (launched) launched.kill("SIGTERM");
    if (mock) mock.server.close();
  }

  let outputs = [];
  const canProduce = !options.dryRun && !options.mock && options.capture;
  if (canProduce) {
    try {
      outputs = await produceRecordings();
    } catch (error) {
      log(`\n!! recording output failed: ${error.message}`);
    }
  }

  const total = sceneSummaries.reduce((sum, scene) => sum + scene.durationMs, 0);
  const totalFrames = sceneSummaries.reduce((sum, scene) => sum + scene.frames, 0);
  log(`\nrecorded ${selected.length} scenes, ${(total / 1000).toFixed(1)} s, ${totalFrames} frames`);
  log(`  ${join(options.out, "timeline.json")}`);
  log(`  ${join(options.out, "markers.json")}`);
  for (const scene of sceneSummaries) {
    log(`  ${join(options.out, scene.id)}  ${scene.frames} frames @ ${scene.fps} fps`);
  }
  if (canProduce && outputs.length > 0) {
    log(`\nclips for the editor (${options.recordings}):`);
    for (const output of outputs) {
      log(`  ${output.name}.mp4${output.video ? `  ${output.video.width}x${output.video.height} ${output.video.fps} fps ${output.video.durationSec}s` : ""}`);
      log(`  ${output.name}.timeline.json${output.sheet ? ` + ${output.name}-sheet.png` : ""}`);
    }
  }
  if (canProduce && !options.encode) {
    log(`\nnext: demo/scripts/frames-to-mp4.sh --root ${options.out} --all`);
  }
  if (options.mock) {
    log(`\nmock mode renders fake wireframe frames — delete them before editing: rm -rf ${options.out}`);
  }
}

main().catch((error) => {
  console.error(`\nrecording failed: ${error.message}`);
  try {
    writeArtifacts();
  } catch (writeError) {
    console.error(`could not write the partial timeline: ${writeError.message}`);
  }
  process.exit(1);
});
