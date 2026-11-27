#!/usr/bin/env node
// Records the final demo's glasses footage from the OFFICIAL Even Hub simulator.
//
//   node demo/scripts/record-final.mjs --glasses /private/tmp/pp-frozen/apps/glasses --scene walk
//
// What it does (and only this):
//   1. runs `vite` for the given glasses folder on its own port, and the official
//      simulator (apps/glasses/node_modules/@evenrealities/evenhub-simulator) on
//      its own automation port. It never touches a process it did not start.
//   2. applies demo/scripts/apply-record-aid.mjs to the FROZEN copy (never the main
//      checkout) so the hold-menu choice, which the simulator cannot send, can be
//      delivered as the same `menu` event the OS would send.
//   3. runs a step list (scroll/tap/menu/wait), screenshotting the framebuffer at
//      ~10 fps, and writes <out>/<name>.mp4 (1152x576) plus <name>.timeline.json
//      with a timestamp for every input and mark.
//
// The app talks to the real Pinpoint server (apps/server) started here in PINPOINT_MODE=cloud
// on a spare port: its built-in SAMPLE workspace (the one every G2 gets out of the box). Voice
// is the server's scripted voice (PINPOINT_SCRIPTED_TRANSCRIPTS), so the sentence on the glasses
// is exactly the sentence the second voice speaks in the film.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const argv = process.argv.slice(2);
const val = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const glasses = resolve(val("--glasses", ""));
const scene = val("--scene", "walk");
const vitePort = Number(val("--vite-port", "5392"));
const simPort = Number(val("--sim-port", "9932"));
const outDir = resolve(val("--out", join(repo, "demo/recordings")));
const prefix = val("--prefix", "final");
const captureMs = Number(val("--capture-ms", "100"));
if (!existsSync(join(glasses, "package.json"))) {
  console.error("--glasses <frozen>/apps/glasses is required");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const menuFile = join(glasses, "public/__menu.json");
let menuSeq = 0;
const MENU = { ask: 7, newTask: 8, agree: 6, refresh: 4, everyday: 10, developer: 11, mixed: 12 };

// ---------------------------------------------------------------- scenes
// step: {wait}, {act:"down|up|click|double_click"}, {menu:id}, {mark}, {note:ms} (tap, speak, tap)
const VOICE_MS = 2800;
const SCENES = {
  // ---- ?mock=1 (the in-browser demo data, mixed story: 5 need you, 2 working, 5 done today) ----
  walk: {
    mock: true,
    url: "?mock=1&sample=1&aid=1",
    steps: [
      { mark: "boot" },
      { wait: 2000, label: "inbox" },
      { menu: MENU.mixed, label: "persona: mixed (5 need you, 2 working, 5 done)", hold: 2200 },
      { mark: "persona" },
      { menu: 100, label: "glasses off", hold: 1800 },
      { mark: "off" },
      { menu: 101, label: "glasses on", hold: 800 },
      { mark: "on" },
      { wait: 4200, label: "status line, Since you looked" },
      { mark: "status" },
      { act: "down", label: "scroll", hold: 450 }, { act: "down", label: "scroll", hold: 450 }, { act: "down", label: "scroll", hold: 450 },
      { act: "down", label: "scroll", hold: 450 }, { act: "down", label: "scroll to Since you looked", hold: 900 },
      { mark: "catchup-focus" },
      { act: "click", label: "open Since you looked", hold: 4200 },
      { mark: "catchup" },
      { act: "double_click", label: "back to the inbox", hold: 1400 },
      { mark: "inbox-again" },
      { act: "down", label: "login-fix", hold: 1300 },
      { mark: "login-focus" },
      { act: "click", label: "open login-fix", hold: 4200 },
      { mark: "deck" },
      { menu: MENU.ask, label: "hold menu: Ask", hold: 5200 },
      { mark: "ask-listen" },
      { act: "click", label: "stop (question asked)", hold: 5200 },
      { mark: "ask-answer" },
      { act: "click", label: "go to the line", hold: 1500 },
      { mark: "back-on-line" },
      { note: VOICE_MS, hold: 2600 },
      { mark: "noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "sent" },
      { wait: 5000, label: "hold" },
      { mark: "end" },
    ],
  },
  everyday: {
    mock: true,
    url: "?mock=1&sample=1&aid=1",
    steps: [
      { mark: "boot" },
      { wait: 2000, label: "inbox" },
      { menu: MENU.everyday, label: "persona: everyday", hold: 2200 },
      { mark: "persona" },
      { mark: "inbox" },
      { mark: "flight-focus" },
      { act: "click", label: "open the flight question", hold: 4200 },
      { mark: "flight-deck" },
      { act: "click", label: "tap: Book it now", hold: 6800 },
      { mark: "flight-sent" },
      { wait: 1200 },
      { mark: "inbox-after-flight" },
      { mark: "plan-focus" },
      { act: "click", label: "open the Saturday plan", hold: 4200 },
      { mark: "plan-deck" },
      { note: VOICE_MS, hold: 2800 },
      { mark: "plan-noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "plan-sent" },
      { wait: 1200 },
      { mark: "inbox-after-plan" },
      { mark: "draft-focus" },
      { act: "click", label: "open the landlord draft", hold: 4200 },
      { mark: "draft-deck" },
      { note: VOICE_MS, hold: 3200 },
      { mark: "draft-noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "draft-sent" },
      { wait: 1200 },
      { mark: "inbox-after-draft" },
      { wait: 2500 },
      { mark: "end" },
    ],
  },
  // ---- cloud sample workspace (real server): landlord draft fixed in place by the AI, then New task by voice + its follow-up ----
  cloud: {
    url: "?aid=1",
    transcripts: ["Three percent, not five percent.", "Find a dentist near the office open Saturday morning."],
    steps: [
      { mark: "boot" },
      { wait: 1000 },
      { menu: MENU.everyday, label: "persona: everyday", hold: 2200 },
      { mark: "persona" },
      { wait: 1500 },
      { act: "down", label: "scroll", hold: 450 }, { act: "down", label: "scroll", hold: 450 }, { act: "down", label: "scroll to the landlord draft", hold: 900 },
      { mark: "draft-focus" },
      { act: "click", label: "open the landlord draft", hold: 4200 },
      { mark: "draft-deck" },
      { note: VOICE_MS, hold: 4200 },
      { mark: "draft-noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "draft-sent" },
      { wait: 1500 },
      { mark: "inbox-after-draft" },
      { menu: MENU.newTask, label: "hold menu: New task", hold: 5200 },
      { mark: "task-listen" },
      { act: "click", label: "stop", hold: 2600 },
      { mark: "task-heard" },
      { act: "click", label: "start the task", hold: 3200 },
      { mark: "task-started" },
      { act: "click", label: "back to the inbox", hold: 9000 },
      { menu: MENU.refresh, label: "refresh", hold: 3000 },
      { mark: "task-question" },
      { wait: 2500 },
      { mark: "end" },
    ],
  },
  // ---- cloud sample workspace (real server, real AI for the in-place fix): the whole everyday day ----
  daily: {
    url: "?aid=1",
    transcripts: ["Skip the picnic. Find an indoor lunch.", "Three percent, not five percent.", "Find a dentist near the office open Saturday morning."],
    steps: [
      { mark: "boot" },
      { wait: 1000 },
      { menu: MENU.everyday, label: "persona: everyday", hold: 2200 },
      { mark: "persona" },
      { wait: 2400, label: "status line" },
      { mark: "inbox" },
      { open: "saturday-plan", tag: "plan-open", hold: 2600 },
      { mark: "plan-deck" },
      { note: VOICE_MS, hold: 2800 },
      { mark: "plan-noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "plan-sent" },
      { wait: 4500, label: "the sample agent answers; the list reloads" },
      { mark: "inbox-after-plan" },
      { open: "landlord-reply", tag: "draft-open", hold: 2600 },
      { mark: "draft-deck" },
      { note: VOICE_MS, hold: 4200 },
      { mark: "draft-noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "draft-sent" },
      { wait: 4500, label: "the sample agent answers; the list reloads" },
      { mark: "inbox-after-draft" },
      { menu: MENU.newTask, label: "hold menu: New task", hold: 3200 },
      { mark: "task-listen" },
      { act: "click", label: "stop", hold: 2600 },
      { mark: "task-heard" },
      { act: "click", label: "start the task", hold: 3200 },
      { mark: "task-started" },
      { wait: 10000, label: "back on the inbox; the sample agent finds 3 dentists" },
      { menu: MENU.refresh, label: "refresh", hold: 3000 },
      { mark: "task-question" },
      { open: "sample-task*", tag: "dentist-open", hold: 2600 },
      { mark: "dentist-options" },
      { act: "click", label: "one tap: choose", hold: 5200 },
      { mark: "dentist-chosen" },
      { wait: 2500 },
      { mark: "end" },
    ],
  },
  // ---- cloud sample workspace (real server): developer morning walk ----
  devwalk: {
    url: "?aid=1",
    transcripts: ["Why sign everyone out?", "Don't sign everyone out. Just fix the broken logins."],
    steps: [
      { mark: "boot" },
      { wait: 1000 },
      { menu: MENU.developer, label: "persona: developer", hold: 1600 },
      { mark: "persona" },
      { menu: 100, label: "glasses off", hold: 1500 },
      { mark: "off" },
      { menu: 101, label: "glasses on", hold: 800 },
      { mark: "on" },
      { wait: 4200, label: "status line, Since you looked" },
      { mark: "status" },
      { mark: "catchup-focus" },
      { act: "click", label: "open Since you looked", hold: 4200 },
      { mark: "catchup" },
      { act: "double_click", label: "back to the inbox", hold: 1400 },
      { mark: "inbox-again" },
      { open: "login-fix", tag: "login-open", hold: 2600 },
      { mark: "deck" },
      { menu: MENU.ask, label: "hold menu: Ask", hold: 3200 },
      { mark: "ask-listen" },
      { act: "click", label: "stop (question asked)", hold: 5200 },
      { mark: "ask-answer" },
      { act: "click", label: "go to the line", hold: 1500 },
      { mark: "back-on-line" },
      { note: VOICE_MS, hold: 2600 },
      { mark: "noted" },
      { act: "click", label: "Send", hold: 6800 },
      { mark: "sent" },
      { wait: 7500, label: "hold the inbox while the real reply is shown" },
      { mark: "end" },
    ],
  },
};

// ---------------------------------------------------------------- process helpers
const children = [];
function start(cmd, args, opts, tag) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...opts });
  child.stdout.on("data", (d) => process.stdout.write(`  ${tag}| ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  ${tag}| ${d}`));
  children.push(child);
  return child;
}
const cleanup = () => children.forEach((c) => { try { process.kill(-c.pid, "SIGTERM"); } catch { /* gone */ } });
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

const base = `http://127.0.0.1:${simPort}`;
async function post(action) {
  const r = await fetch(`${base}/api/input`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  return r.ok;
}
async function shot() {
  const r = await fetch(`${base}/api/screenshot/glasses`, { signal: AbortSignal.timeout(5000) });
  return Buffer.from(await r.arrayBuffer());
}
function sendMenu(id) {
  menuSeq += 1;
  writeFileSync(menuFile, JSON.stringify({ seq: menuSeq, id }));
}

async function main() {
  const def = SCENES[scene];
  if (!def) throw new Error(`unknown scene ${scene}`);
  // 1. recording aid on the frozen copy only.
  execFileSync(process.execPath, [join(here, "apply-record-aid.mjs"), join(glasses, "src/main.ts")], { stdio: "inherit" });
  mkdirSync(join(glasses, "public"), { recursive: true });
  writeFileSync(menuFile, JSON.stringify({ seq: 0, id: 0 }));

  // 2. the real server (sample workspace, scripted voice), dev server, official simulator.
  const serverPort = Number(val("--server-port", "8942"));
  if (!def.mock) {
    const serverDir = resolve(val("--server", join(glasses, "../server")));
    const dataDir = join(outDir, `.${prefix}-${scene}-data`);
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    const scriptFile = join(dataDir, "transcripts.json");
    writeFileSync(scriptFile, JSON.stringify({ delayMs: 1200, notes: (def.transcripts ?? []).map((text) => ({ text })) }));
    // Optional: AI settings from the main checkout's .env (the LLM that fixes "Three percent, not five percent"
    // in place). Values go straight into the child's environment and are never printed.
    const extra = {};
    const envFile = val("--env-file", "");
    if (envFile && existsSync(envFile)) {
      for (const line of readFileSync(envFile, "utf8").split("\n")) {
        const m = /^\s*(DEEPSEEK_[A-Z_]*|PINPOINT_(?:AI|LLM|REVIEW)[A-Z_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (m) extra[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    start(join(serverDir, "node_modules/.bin/tsx"), ["src/index.ts"], {
      cwd: serverDir,
      env: { ...extra, PATH: process.env.PATH, HOME: process.env.HOME, PINPOINT_MODE: "cloud", PINPOINT_PORT: String(serverPort), PINPOINT_HOST: "127.0.0.1",
        PINPOINT_DATA_DIR: dataDir, PINPOINT_ALLOWED_ORIGINS: "*", PINPOINT_SCRIPTED_TRANSCRIPTS: scriptFile, PINPOINT_SAMPLE_TASK_MS: "7000", PINPOINT_SAMPLE_REPLY_MS: "1800" },
    }, "server");
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${serverPort}/`); break; } catch { /* wait */ }
      await sleep(250);
    }
  }
  start(join(glasses, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: glasses, env: { ...process.env, VITE_PINPOINT_SERVER: `http://127.0.0.1:${serverPort}` } }, "vite");
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${vitePort}/`)).ok) break; } catch { /* wait */ }
    await sleep(250);
  }
  const frames = join(outDir, `.${prefix}-${scene}-frames`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const sim = join(glasses, "node_modules/@evenrealities/evenhub-simulator/bin/index.js");
  start(process.execPath, [sim, `http://127.0.0.1:${vitePort}/${def.url}`, "--automation-port", String(simPort)], { cwd: glasses }, "sim");
  for (let i = 0; i < 60; i++) {
    try { if ((await (await fetch(`${base}/api/ping`)).text()).trim() === "pong") break; } catch { /* wait */ }
    await sleep(250);
  }
  // Wait for the app's first log line so input is not dropped.
  for (let i = 0; i < 60; i++) {
    try {
      const { entries = [] } = await (await fetch(`${base}/api/console`)).json();
      if (entries.some((e) => /\[pinpoint\] screen=/.test(String(e.message)))) break;
    } catch { /* wait */ }
    await sleep(250);
  }

  // 3. capture loop + steps.
  const t0 = Date.now();
  let n = 0;
  let capturing = true;
  const times = [];
  const cap = (async () => {
    while (capturing) {
      const a = Date.now();
      try {
        const png = await shot();
        n += 1;
        writeFileSync(join(frames, String(n).padStart(5, "0") + ".png"), png);
        times.push(Date.now() - t0);
      } catch { /* skip a frame */ }
      await sleep(Math.max(0, captureMs - (Date.now() - a)));
    }
  })();
  const timeline = { scene, recordedAt: new Date().toISOString(), inputs: [], marks: [] };
  const now = () => Date.now() - t0;
  async function gotoThread(s) {
          // Move the inbox cursor to a thread using the app's own console log (ids + cursor). If the list
          // reloads while we move (the sample agent answering), start again: a reload resets the cursor.
          const read = async () => {
            const { entries = [] } = await (await fetch(`${base}/api/console`)).json();
            let ids = [], focus = 0, mark = -1;
            for (const e of entries) {
              const line = String(e.message);
              const a = line.match(/^\[pinpoint\] inbox-ids=(.*)$/);
              if (a) { ids = a[1].split(","); focus = 0; mark = e.id; }
              const b = line.match(/^\[pinpoint\] screen=inbox items=\d+ focus=(\d+)/);
              if (b) { focus = Number(b[1]); mark = e.id; }
            }
            return { ids, focus, mark };
          };
          let done = false;
          for (let attempt = 0; attempt < 8 && !done; attempt++) {
            await sleep(1400);
            const first = await read();
            const has = (ids) => ids.findIndex((x) => (s.goto.endsWith('*') ? x.startsWith(s.goto.slice(0, -1)) : x === s.goto));
            if (has(first.ids) < 0) continue;
            await sleep(600);
            const second = await read();
            if (second.mark !== first.mark) continue; // still reloading
            const target = has(second.ids);
            const delta = target - second.focus;
            for (let i = 0; i < Math.abs(delta); i++) { await post(delta > 0 ? "down" : "up"); await sleep(750); }
            await sleep(500);
            const third = await read();
            if (third.mark !== second.mark) continue; // reloaded mid-move
            timeline.inputs.push({ t: now(), action: "move", label: `cursor to ${s.goto}`, from: second.focus, to: target });
            done = true;
          }
          if (!done) throw new Error(`goto ${s.goto}: could not settle on it`);
          await sleep(s.hold ?? 900);
        }
  
  async function run(steps) {
    for (const s of steps) {
      if (s.mark) timeline.marks.push({ t: now(), label: s.mark });
      else if (s.wait !== undefined) await sleep(s.wait);
      else if (s.act) { timeline.inputs.push({ t: now(), action: s.act, label: s.label ?? s.act }); await post(s.act); await sleep(s.hold ?? 700); }
      else if (s.goto) await gotoThread(s);
      else if (s.open) {
        // Open a thread and verify the app really opened it; if not, back out and try again.
        const want = s.open;
        let ok = false, openedAt0 = 0;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          await gotoThread({ goto: want, hold: 600 });
          timeline.inputs.push({ t: now(), action: "click", label: `open ${want}` });
          const openedAt = now();
          openedAt0 = openedAt;
          await post("click");
          await sleep(1600);
          const { entries = [] } = await (await fetch(`${base}/api/console`)).json();
          const last = entries.map((e) => String(e.message)).filter((m) => /^\[pinpoint\] opening=/.test(m)).at(-1) ?? "";
          const got = last.replace("[pinpoint] opening=", "");
          ok = want.endsWith("*") ? got.startsWith(want.slice(0, -1)) : got === want;
          if (!ok) { await post("double_click"); await sleep(1500); }
        }
        if (!ok) throw new Error(`open ${want}: the app opened something else`);
        if (s.tag) timeline.marks.push({ t: openedAt0, label: s.tag });
        await sleep(s.hold ?? 2600);
      }
      else if (s.menu !== undefined) { timeline.inputs.push({ t: now(), action: "menu", id: s.menu, label: s.label ?? `menu ${s.menu}` }); sendMenu(s.menu); await sleep(s.hold ?? 900); }
      else if (s.note) {
        timeline.inputs.push({ t: now(), action: "click", label: "tap to talk" }); await post("click");
        await sleep(s.note);
        timeline.inputs.push({ t: now(), action: "click", label: "tap to stop" }); await post("click");
        await sleep(s.hold ?? 2200);
      }
    }
  }
  try { await run(def.steps); } catch (error) { console.error("STEP FAILED (saving the partial take):", error.message); timeline.failed = error.message; }
  capturing = false;
  await cap;
  const durationMs = now();
  const fps = n / (durationMs / 1000);
  try {
    const { entries = [] } = await (await fetch(`${base}/api/console`)).json();
    timeline.console = entries.map((e) => String(e.message)).filter((m) => /^\[pinpoint\] (opening|inbox-ids|inbox-header|screen=|ask |task |note=|sent |wear|sample-)/.test(m));
  } catch { /* optional */ }
  timeline.durationMs = durationMs;
  timeline.frames = n;
  timeline.fps = Number(fps.toFixed(3));
  timeline.frameTimes = times;
  mkdirSync(outDir, { recursive: true });
  const mp4 = join(outDir, `${prefix}-${scene}.mp4`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:s=576x288:r=30", "-framerate", fps.toFixed(3), "-i", join(frames, "%05d.png"),
    "-filter_complex", "[0][1]overlay=0:0:shortest=1,scale=1152:576:flags=neighbor,fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", mp4]);
  writeFileSync(join(outDir, `${prefix}-${scene}.timeline.json`), JSON.stringify(timeline, null, 1));
  rmSync(frames, { recursive: true, force: true });
  console.log(`recorded ${scene}: ${(durationMs / 1000).toFixed(1)} s, ${n} frames, ${fps.toFixed(2)} fps -> ${mp4}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
