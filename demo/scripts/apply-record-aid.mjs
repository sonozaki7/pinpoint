#!/usr/bin/env node
// Recording aid for the frozen demo checkout ONLY (never run it in the main checkout).
//
// The official Even Hub simulator (0.9.5) cannot draw or drive the glasses'
// hold menu ("Add contextual menu simulation" is on its roadmap). On a real
// pair, hold opens the OS menu and the app receives the chosen item as a
// `menu` event (and the wear sensor's on/off, ids 100/101). This appends ~20 lines to <glasses>/src/main.ts that read a
// tiny JSON file the recorder writes and deliver the same `menu` event, so
// "New task" and "Ask" can be filmed in the real app. Nothing else changes.
//
//   node demo/scripts/apply-record-aid.mjs <path-to-frozen>/apps/glasses/src/main.ts
//
// The recorder writes <glasses>/public/__menu.json as {"seq": n, "id": menuId}.
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: apply-record-aid.mjs <frozen>/apps/glasses/src/main.ts");
  process.exit(2);
}
if (/Desktop\/Project\/pinpoint\/apps\//.test(target)) {
  console.error("refusing to patch the main checkout");
  process.exit(2);
}
const marker = "// --- recording aid (demo only) ---";
const source = readFileSync(target, "utf8");
if (source.includes(marker)) {
  console.log("already applied");
  process.exit(0);
}
const aid = `
${marker}
// Delivers the hold-menu choice (ids 100/101 = take the glasses off / put them on, the wear sensor the simulator lacks) the Even Hub simulator cannot send. Polls /__menu.json.
if (new URLSearchParams(location.search).get("aid") === "1") {
  let seen = -1;
  setInterval(async () => {
    try {
      const body = await (await fetch("/__menu.json?t=" + Date.now(), { cache: "no-store" })).json();
      if (typeof body.seq !== "number") return;
      if (seen < 0) { seen = body.seq; return; }
      if (body.seq !== seen) { seen = body.seq; console.info("[pinpoint] aid-menu=" + body.id); const id = Number(body.id); if (id === 100 || id === 101) simulateWear(id === 101); else void handleMenu(id); }
    } catch { /* no file yet */ }
  }, 150);
}
`;
writeFileSync(target, source + aid);
console.log("recording aid appended to", target);
