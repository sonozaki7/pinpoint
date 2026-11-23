import { strict as assert } from "node:assert";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = await access(chromePath).then(() => chromePath).catch(() => undefined);
const app = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
let browser;

try {
  await app.listen();
  const base = app.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath, headless: true });

  // Phone-width layout: no horizontal overflow, no clipped controls.
  const phone = await browser.newPage({ viewport: { width: 320, height: 900 } });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await phone.setViewportSize({ width, height: 900 });
    await phone.goto(`${base}?mock=1`);
    await phone.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 4);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `page overflow at ${width}px`);
    for (const selector of [".controls", ".glasses", ".console"]) {
      const clipped = await phone.evaluate((selector) => {
        const node = document.querySelector(selector);
        return node ? node.scrollWidth > node.clientWidth + 1 : false;
      }, selector);
      assert.equal(clipped, false, `${selector} clipped at ${width}px`);
    }
  }
  assert.match(await phone.locator("#glasses-head").innerText(), /PINPOINT \| 3 need you[\s\S]*demo data/);
  await phone.close();

  // Mock only the Flutter host transport and drive the real pinned SDK.
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    window.__bridgeCalls = [];
    window.flutter_inappwebview = {
      callHandler: async (handler, raw) => {
        const message = JSON.parse(raw);
        window.__bridgeCalls.push({ handler, ...message });
        if (message.method === "createStartUpPageContainer") return 0;
        return true;
      },
    };
  });
  await page.goto(`${base}?mock=1`);
  await page.waitForFunction(() => typeof window._listenEvenAppMessage === "function");
  await page.waitForFunction(() => document.querySelector("#host-status")?.textContent?.includes("Glasses connected"));
  await page.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 4);
  await page.waitForFunction(() => window.__bridgeCalls.some((call) =>
    call.method === "rebuildPageContainer" && (call.data.listObject?.length ?? 0) > 0));
  assert.match(await page.locator("#glasses-head").innerText(), /PINPOINT \| 3 need you/);

  const emit = (type, jsonData) => page.evaluate(({ type, jsonData }) => window._listenEvenAppMessage({
    type: "listen_even_app_data", method: "evenHubEvent", data: { type, jsonData },
  }), { type, jsonData });
  const calls = () => page.evaluate(() => window.__bridgeCalls);
  const waitText = (selector, text) => page.waitForFunction(
    ([selector, text]) => document.querySelector(selector)?.textContent?.includes(text),
    [selector, text],
  );

  const startup = (await calls()).find(({ method }) => method === "createStartUpPageContainer");
  const startupBoxes = [...(startup.data.textObject ?? []), ...(startup.data.listObject ?? [])];
  assert.equal(startupBoxes.filter((box) => box.isEventCapture === 1).length, 1);
  const listRebuild = (await calls())
    .filter(({ method, data }) => method === "rebuildPageContainer" && (data.listObject?.length ?? 0) > 0)
    .at(-1);
  assert.ok(listRebuild, "the inbox list was rebuilt after boot");
  assert.equal(listRebuild.data.textObject.filter((box) => box.isEventCapture === 1).length, 0);
  assert.equal(listRebuild.data.listObject.filter((box) => box.isEventCapture === 1).length, 1);
  assert.equal(listRebuild.data.menuObject.menuItems.length, 1);

  await page.locator("#glasses-list li").nth(1).click();
  await waitText("#glasses-head", "auth-refresh-fix");
  await waitText("#glasses-rows", "Force-logout all users");
  assert.equal(await page.locator("#glasses-rows .row").count(), 4);

  const review = (await calls()).filter(({ method }) => method === "rebuildPageContainer").at(-1);
  assert.equal(review.data.containerTotalNum, 8);
  assert.equal(review.data.menuObject.menuItems.length, 4);
  assert.equal(review.data.menuObject.menuItems[0].itemName, "Send review");

  for (let i = 0; i < 3; i++) {
    await emit("sysEvent", { eventType: 2, eventSource: 1 });
    await delay(120);
  }
  await waitText("#glasses-head", "4/7");
  assert.match(await page.locator("#glasses-rows .row").nth(3).innerText(), /Force-logout all users/);

  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "REC");
  await delay(900);
  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "Heard: No, keep the existing sessions");
  assert.match(await page.locator("#glasses-rows .row").nth(3).innerText(), /^!x 4 /);
  const audio = (await calls()).filter(({ method }) => method === "audioControl");
  assert.equal(audio.at(-2)?.data.isOpen, true);
  assert.equal(audio.at(-2)?.data.source, "glasses");
  assert.equal(audio.at(-1)?.data.isOpen, false);

  for (let i = 0; i < 4; i++) {
    await emit("sysEvent", { eventType: 2, eventSource: 1 });
    await delay(120);
  }
  await waitText("#glasses-rows", "Send review (1 note)");
  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "1 objection, 6 agreed");
  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "Sent to agent");
  await delay(1_800);
  await page.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 3);
  assert.match(await page.locator("#glasses-head").innerText(), /2 need you/);

  // Root double-tap must ask the host for the system exit dialog, mode 1.
  await emit("sysEvent", { eventType: 3, eventSource: 1 });
  await page.waitForFunction(() => window.__bridgeCalls.some(({ method }) => method === "shutDownPageContainer"));
  const exit = (await calls()).find(({ method }) => method === "shutDownPageContainer");
  assert.equal(exit.data.exitMode, 1);

  await page.close();
  console.log("Pinpoint browser preview and SDK transport checks passed (320-1440px, focus, voice, preview, send, exit mode 1).");
} finally {
  await browser?.close();
  await app.close();
}
