import { strict as assert } from "node:assert";
import { execFile, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { compositeGlassesPng, maxAlphaIn } from "./png.mjs";

const VOICE_TEXT = "No, keep the existing sessions and migrate them instead.";
const SHOTS = fileURLToPath(new URL("../../../demo/shots/", import.meta.url));

function parseArgs(argv) {
  let port = 9898;
  let server = "http://127.0.0.1:8788";
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--server") {
      server = argv[++index] ?? "";
    } else if (arg.startsWith("--server=")) {
      server = arg.slice("--server=".length);
    } else if (/^\d+$/.test(arg)) {
      port = Number(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "invalid automation port");
  assert.match(server, /^https?:\/\//, "invalid server URL");
  return { port, server: server.replace(/\/+$/, "") };
}

const { port, server } = parseArgs(process.argv.slice(2));
const base = `http://127.0.0.1:${port}`;
await mkdir(SHOTS, { recursive: true });

let consoleCursor = 0;
const pinpointLogs = [];

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function request(urlPath, body) {
  const response = await fetch(base + urlPath, {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`${urlPath}: HTTP ${response.status}`);
  return response;
}

function execFileP(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${file} failed: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

async function pollConsole() {
  const response = await request(`/api/console?since_id=${consoleCursor}`);
  const log = await response.json();
  for (const entry of log.entries ?? []) {
    if (typeof entry.id === "number" && entry.id >= consoleCursor) consoleCursor = entry.id + 1;
    if (typeof entry.message === "string" && entry.message.includes("[pinpoint]")) {
      pinpointLogs.push(entry.message);
    }
  }
}

async function waitForLog(pattern, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastFull = 0;
  while (Date.now() < deadline) {
    await pollConsole();
    let found = pinpointLogs.find((line) => pattern.test(line));
    if (found) return found;
    if (Date.now() - lastFull > 2_000) {
      lastFull = Date.now();
      const response = await request("/api/console");
      const log = await response.json();
      for (const entry of log.entries ?? []) {
        if (typeof entry.message === "string" && entry.message.includes("[pinpoint]") &&
          !pinpointLogs.includes(entry.message)) {
          pinpointLogs.push(entry.message);
        }
      }
      found = pinpointLogs.find((line) => pattern.test(line));
      if (found) return found;
    }
    await delay(180);
  }
  throw new Error(`Simulator did not log ${description}. Last logs:\n${pinpointLogs.slice(-8).join("\n")}`);
}

async function input(action) {
  await request("/api/input", { action });
}

/** Rows sit at y=38, 67, 96 and 125, 28 px tall; the simulator stores text brightness in alpha. */
const ROW_BANDS = [0, 1, 2, 3].map((index) => ({ x: 18, y: 38 + index * 29, width: 540, height: 28 }));

function assertFocusedBrightness(raw, focusRow, name) {
  const peaks = ROW_BANDS.map((band) => maxAlphaIn(raw, band));
  const other = Math.max(...peaks.filter((_, index) => index !== focusRow));
  assert.ok(peaks[focusRow] >= 240, `${name}: focused row is bright (${peaks.join(", ")})`);
  assert.ok(other <= 225, `${name}: other rows stay dim (${peaks.join(", ")})`);
  assert.ok(
    peaks[focusRow] - other >= 25,
    `${name}: focused row is unmistakably brighter (${peaks.join(", ")})`,
  );
  console.log(`focus brightness ${name}: ${peaks.join(", ")} (row ${focusRow + 1} focused)`);
}

async function screenshot(name, options = {}) {
  const { minLit = 150, focusRow } = options;
  const response = await request("/api/screenshot/glasses");
  const raw = Buffer.from(await response.arrayBuffer());
  assert.equal(raw.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${name} is a PNG`);
  assert.equal(raw.readUInt32BE(16), 576, `${name} width`);
  assert.equal(raw.readUInt32BE(20), 288, `${name} height`);
  if (focusRow !== undefined) assertFocusedBrightness(raw, focusRow, name);
  const lit = compositeGlassesPng(raw);
  const green = lit.reduce((sum, byte, index) => index % 3 === 1 && byte > 12 ? sum + 1 : sum, 0);
  assert.ok(green >= minLit, `${name} has visible glyphs (${green} lit pixels)`);
  await writeFile(`${SHOTS}${name}`, lit);
  console.log(`saved demo/shots/${name} (${green} lit pixels)`);
}

// The app must be pointed at the real demo server, not its in-memory fallback.
const health = await json(`${server}/api/health`);
assert.equal(health.ok, true, "server health");
assert.equal(health.mode, "demo", "server runs in demo mode");
const serverInbox = await json(`${server}/api/inbox`);
assert.equal(serverInbox.items.length, 4, "four demo threads on the server");
for (const threadId of ["deps-upgrade", "auth-refresh-fix", "flaky-e2e", "inbox-morning"]) {
  assert.ok(serverInbox.items.some((item) => item.threadId === threadId), `server lists ${threadId}`);
}
console.log(`server ${server} mode=demo threads=${serverInbox.items.length}`);

// Generate a real spoken objection; the simulator reads the MacBook microphone.
const audioDir = path.join(tmpdir(), `pinpoint-sim-${process.pid}`);
await mkdir(audioDir, { recursive: true });
const voiceAiff = path.join(audioDir, "voice.aiff");
const voiceWav = path.join(audioDir, "voice.wav");
await execFileP("say", ["-v", "Samantha", "-r", "150", "-o", voiceAiff, VOICE_TEXT]);
await execFileP("ffmpeg", [
  "-y", "-loglevel", "error", "-i", voiceAiff,
  "-af", "adelay=900",
  "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", voiceWav,
]);
console.log(`voice fixture ready: "${VOICE_TEXT}" (${voiceWav})`);

function playVoice() {
  return new Promise((resolve, reject) => {
    const child = spawn("afplay", ["-v", "1.4", voiceWav], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`afplay exited ${code}`));
    });
  });
}

await pollConsole();
await waitForLog(new RegExp(`\\[pinpoint\\] server=${server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the server URL");
await waitForLog(/\[pinpoint\] ready/, "the SDK startup");
await waitForLog(/mode=live screen=inbox items=4/, "the real server inbox");
await waitForLog(/inbox-header="PINPOINT \| 4 need you"/, "a four-thread inbox header");
await delay(500);
await screenshot("glasses-01-inbox.png");

await input("down");
await delay(250);
await input("click");
await waitForLog(/screen=review thread=auth-refresh-fix/, "the auth review");
await waitForLog(/review-header="auth-refresh-fix \| 1\/7"/, "the review header");
await delay(500);
await screenshot("glasses-02-review.png", { focusRow: 0 });

await input("context_menu");
await delay(600);
await screenshot("glasses-03-menu.png");
await input("context_menu");
await delay(500);

for (let i = 0; i < 3; i++) {
  await input("down");
  await delay(320);
}
await waitForLog(/\[pinpoint\] focus=4\b/, "focus on point 4");
await screenshot("glasses-04-point4.png", { focusRow: 3 });

await input("click");
await waitForLog(/recording point=p4/, "the microphone opening");
await delay(700);
const voiceDone = playVoice();
await delay(900);
await screenshot("glasses-05-recording.png");
await voiceDone;
await delay(350);

await input("click");
const pcmLog = await waitForLog(/voice pcm-bytes=\d+/, "the captured PCM");
const pcmBytes = Number(pcmLog.match(/pcm-bytes=(\d+)/)?.[1] ?? 0);
assert.ok(pcmBytes >= 32_000, `microphone captured real audio (${pcmBytes} bytes)`);
const noteLog = await waitForLog(/note=p4 verdict=object text=".+"/, "the transcribed objection", 45_000);
const transcript = noteLog.match(/text="(.+)"/)?.[1] ?? "";
console.log(`real microphone note (${pcmBytes} bytes): "${transcript}"`);
await waitForLog(/review-header="auth-refresh-fix \| 4\/7 \| 1 objection"/, "the objection header");
await delay(350);
await screenshot("glasses-06-note.png");

for (let i = 0; i < 4; i++) {
  await input("down");
  await delay(320);
}
await waitForLog(/\[pinpoint\] focus=8\b/, "focus on the send row");
await screenshot("glasses-07-send-row.png", { focusRow: 3 });

await input("click");
await waitForLog(/preview objections=1/, "the composed preview");
await delay(450);
await screenshot("glasses-08-preview.png");

await input("click");
await delay(380);
await screenshot("glasses-09-sent.png");
await waitForLog(/screen=inbox items=3/, "the post-send inbox");
await waitForLog(/inbox-ids=(?!.*auth-refresh-fix)/, "an inbox without the sent thread");
await waitForLog(/inbox-header="PINPOINT \| 3 need you"/, "a three-thread inbox header");
await delay(500);
await screenshot("glasses-10-inbox-after.png");

await input("click");
await waitForLog(/screen=review thread=deps-upgrade/, "the question review");
await delay(450);
await input("click");
await waitForLog(/screen review->options/, "the options screen");
await delay(520);
await screenshot("glasses-11-options.png");

await input("click");
await waitForLog(/screen options->review/, "the chosen answer");
await delay(520);
await screenshot("glasses-12-answer.png");

await input("double_click");
await delay(550);
await input("double_click");
await waitForLog(/exit-dialog/, "the root double-tap exit");
await delay(800);
await screenshot("glasses-13-exit.png", { minLit: 0 });

console.log("Pinpoint simulator flow passed against the real server: inbox, review, focus brightness, voice note, send, inbox removal, options, answer and exit dialog.");
await rm(audioDir, { recursive: true, force: true });
