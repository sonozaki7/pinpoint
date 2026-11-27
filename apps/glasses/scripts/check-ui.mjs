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
    await phone.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 6);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `page overflow at ${width}px`);
    for (const selector of [".actions", ".gestures", ".console"]) {
      const clipped = await phone.evaluate((selector) => {
        const node = document.querySelector(selector);
        return node ? node.scrollWidth > node.clientWidth + 1 : false;
      }, selector);
      assert.equal(clipped, false, `${selector} clipped at ${width}px`);
    }
  }
  assert.match(await phone.locator("#glasses-head").textContent(), /Pinpoint · 5 need you · 2 working · 5 done today[\s\S]*demo data/);
  assert.equal(await phone.locator("#btn-reset-sample").isDisabled(), true);
  assert.match(await phone.locator("#phone-status").innerText(), /Demo data/);
  assert.match(await phone.locator(".gestures").innerText(), /Scroll[\s\S]*Tap[\s\S]*Double-tap[\s\S]*Hold/);
  assert.match(await phone.locator(".privacy").innerText(), /transcribed, then discarded/);
  assert.equal(await phone.locator("#developer-controls").evaluate((node) => node.open), false);
  await phone.close();

  // No server must show the offline screen, never silently substitute demo data.
  const offline = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await offline.route("http://127.0.0.1:8787/**", (route) => route.abort());
  await offline.goto(base);
  await offline.waitForFunction(() =>
    document.querySelector("#glasses-pane")?.textContent?.includes("Can't reach the local server"));
  assert.match(await offline.locator("#glasses-pane").textContent(), /Start it, then tap to retry/);
  assert.match(await offline.locator("#phone-status").innerText(), /offline/);
  await offline.close();

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
  await page.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 6);
  await page.waitForFunction(() => window.__bridgeCalls.some((call) =>
    call.method === "rebuildPageContainer" && (call.data.listObject?.length ?? 0) > 0));
  assert.match(await page.locator("#glasses-head").textContent(), /Pinpoint · 5 need you · 2 working · 5 done today/);
  const inboxRows = await page.evaluate(() =>
    [...document.querySelectorAll("#glasses-list li")].map((node) => node.textContent ?? ""));
  assert.match(inboxRows[0] ?? "", /^Agent {2}flight-price {2}question · 1 needs you/, "the question sorts first");
  assert.match(inboxRows[1] ?? "", /^Agent {2}login-fix/);
  assert.match(inboxRows[3] ?? "", /^Notion {2}launch-post {2}7 points · 1 needs you/);
  assert.match(inboxRows[4] ?? "", /^Mail {2}Re: lease renewal {2}6 lines · 1 needs you/, "the server's own summary");
  assert.match(inboxRows[5] ?? "", /^Agent {2}Since you looked {2}3 updates · 1 needs you/, "the catch-up row sits last");
  await page.locator("#developer-controls").evaluate((node) => { node.open = true; });

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
  assert.deepEqual(listRebuild.data.menuObject.menuItems.map((item) => item.itemName), ["New task", "Refresh"], "a question row has no Agree & send");

  await page.evaluate(() => document.querySelectorAll("#glasses-list li")[1]?.click());
  await waitText("#glasses-head", "login-fix");
  await waitText("#glasses-rows", "Sign out every customer once");
  // Only what needs you is listed; the six routine steps are one row.
  assert.equal(await page.locator("#glasses-rows .row").count(), 3);
  assert.match(await page.locator("#glasses-rows").textContent(), /\+6 routine · agreed/);
  assert.match(await page.locator("#glasses-pane").textContent(), /Why: \S/);
  assert.match(await page.locator("#glasses-head").textContent(), /login-fix · 1 needs you/);
  assert.doesNotMatch(await page.locator("#glasses-head").textContent(), /objection/);

  const review = (await calls()).filter(({ method }) => method === "rebuildPageContainer").at(-1);
  assert.equal(review.data.containerTotalNum, 7);
  assert.equal(review.data.menuObject.menuItems.length, 5);
  assert.equal(review.data.menuObject.menuItems[0].itemName, "Ask", "Ask is the first hold-menu item");
  const reviewRows = review.data.textObject.filter((box) => box.containerName.startsWith("row"));
  assert.equal(reviewRows.length, 3);
  assert.equal(reviewRows[0].textColor, 4, "the flagged step is the brightest row on open");
  assert.match(reviewRows[0].content, /^> 4 .*CHECK$/);
  assert.deepEqual(reviewRows.slice(1).map((row) => row.textColor), [1, 2], "routine row dimmest, Send row 2");
  for (const row of reviewRows.slice(1)) {
    assert.match(row.content, /^ {3}/, `${row.containerName} has no cursor`);
  }

  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "Recording");
  await delay(900);
  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "You said: Don't sign everyone out");
  // The cursor moves to the Send row by itself and the Send row names the count.
  assert.match(await page.locator("#glasses-rows").textContent(), /> Send · 1 change, 6 OK/);
  assert.match(await page.locator("#glasses-head").textContent(), /login-fix · 1 needs you · 1 change/);
  assert.match(await page.locator("#glasses-rows .row").nth(2).textContent(), /^> Send/);
  const audio = (await calls()).filter(({ method }) => method === "audioControl");
  assert.equal(audio.at(-2)?.data.isOpen, true);
  assert.equal(audio.at(-2)?.data.source, "glasses");
  assert.equal(audio.at(-1)?.data.isOpen, false);

  // Tap starts the 5 s undo countdown; no preview screen and no second tap.
  await emit("sysEvent", { eventSource: 1 });
  await waitText("#glasses-pane", "Sending in 5 · Tap to undo");
  assert.match(await page.locator("#glasses-footer").textContent(), /Tap: undo/);
  await waitText("#glasses-pane", "Review delivered to login-fix");
  await page.waitForFunction(() => document.querySelector("#glasses-list")?.children.length === 5, undefined, { timeout: 8_000 });
  assert.match(await page.locator("#glasses-head").textContent(), /4 need you · 2 working · 6 done today/);

  // Wear: off then on lands on the inbox with the status line and "Since you looked", no gesture.
  await page.evaluate(() => { window.pinpoint.simulateWear(false); });
  await page.evaluate(() => { window.pinpoint.simulateWear(true); });
  await waitText("#glasses-head", "Since you looked");
  assert.match(await page.locator("#glasses-head").textContent(), /need you · 2 working[\s\S]*Since you looked · 3 updates/);
  await page.keyboard.press("ArrowDown");
  assert.match(await page.locator("#glasses-head").textContent(), /Since you looked/, "scrolling keeps the welcome line");

  // Root double-tap must ask the host for the system exit dialog, mode 1.
  await emit("sysEvent", { eventType: 3, eventSource: 1 });
  await page.waitForFunction(() => window.__bridgeCalls.some(({ method }) => method === "shutDownPageContainer"));
  const exit = (await calls()).find(({ method }) => method === "shutDownPageContainer");
  assert.equal(exit.data.exitMode, 1);

  await page.close();
  console.log("Pinpoint browser preview and SDK transport checks passed (320-1440px, app tags, flagged start, voice, countdown, receipt, exit mode 1).");
} finally {
  await browser?.close();
  await app.close();
}
