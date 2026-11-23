import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { compositeGlassesPng } from "./png.mjs";

const port = Number(process.argv[2] ?? 9898);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "invalid automation port");
const base = `http://127.0.0.1:${port}`;
const shots = fileURLToPath(new URL("../../../demo/shots/", import.meta.url));
await mkdir(shots, { recursive: true });

let consoleCursor = 0;
const pinpointLogs = [];

async function request(path, body) {
  const response = await fetch(base + path, {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
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

async function tapPause() {
  await delay(420);
}

async function screenshot(name, minLit = 150) {
  const response = await request("/api/screenshot/glasses");
  const raw = Buffer.from(await response.arrayBuffer());
  assert.equal(raw.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${name} is a PNG`);
  assert.equal(raw.readUInt32BE(16), 576, `${name} width`);
  assert.equal(raw.readUInt32BE(20), 288, `${name} height`);
  const lit = compositeGlassesPng(raw);
  const green = lit.reduce((sum, byte, index) => index % 3 === 1 && byte > 12 ? sum + 1 : sum, 0);
  assert.ok(green >= minLit, `${name} has visible glyphs (${green} lit pixels)`);
  await writeFile(`${shots}${name}`, lit);
  console.log(`saved demo/shots/${name} (${green} lit pixels)`);
}

await pollConsole();
await waitForLog(/\[pinpoint\] ready/, "the SDK startup");
await waitForLog(/screen=inbox items=4/, "the demo inbox");
await delay(500);
await screenshot("glasses-01-inbox.png");

await input("down");
await delay(250);
await input("click");
await waitForLog(/screen=review thread=auth-refresh-fix/, "the auth review");
await delay(500);
await screenshot("glasses-02-review.png");

await input("context_menu");
await delay(600);
await screenshot("glasses-03-menu.png");
await input("context_menu");
await delay(500);

for (let i = 0; i < 3; i++) {
  await input("down");
  await delay(320);
}
await screenshot("glasses-04-point4.png");

await input("click");
await delay(1_100);
await screenshot("glasses-05-recording.png");

await input("click");
await waitForLog(/note=p4 verdict=object/, "the scripted voice note");
await delay(350);
await screenshot("glasses-06-note.png");

for (let i = 0; i < 4; i++) {
  await input("down");
  await delay(320);
}
await screenshot("glasses-07-send-row.png");

await input("click");
await waitForLog(/preview objections=1/, "the composed preview");
await delay(450);
await screenshot("glasses-08-preview.png");

await input("click");
await delay(380);
await screenshot("glasses-09-sent.png");
await waitForLog(/screen=inbox items=3/, "the post-send inbox");
await delay(500);
await screenshot("glasses-10-inbox-after.png");

await input("click");
await waitForLog(/screen=review thread=deps-upgrade/, "the question review");
await delay(450);
await input("click");
await delay(520);
await screenshot("glasses-11-options.png");

await input("click");
await delay(520);
await screenshot("glasses-12-answer.png");

await input("double_click");
await delay(550);
await input("double_click");
await waitForLog(/exit-dialog/, "the root double-tap exit");
await delay(800);
await screenshot("glasses-13-exit.png", 0);

console.log("Pinpoint simulator flow passed: inbox, review, menu, voice note, send row, preview, send, options, answer and exit dialog.");
