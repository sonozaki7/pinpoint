#!/usr/bin/env node
/**
 * Post-build: put the real glasses app on the site at /app/.
 *
 * The glasses project already knows how to build itself in device mode (its
 * own tsconfig checks it too); this script asks it to, then copies the static
 * output beside the simulator. The device build points at Pinpoint Cloud, so
 * the QR code and the "open in this browser" link exercise the same API as the
 * reviewed product.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const glassesRoot = path.resolve(webRoot, "..", "glasses");
const dist = path.resolve(webRoot, "dist");
const output = path.resolve(dist, "app");
const glassesDist = path.resolve(glassesRoot, "dist-even");

function fail(message) {
  console.error(`\n[build-app] ${message}\n`);
  process.exit(1);
}

if (!existsSync(path.join(dist, "index.html"))) {
  fail("dist/index.html is missing. Run this after `vite build`.");
}
if (!existsSync(path.join(dist, "media", "g2-qr.svg"))) {
  fail("dist/media/g2-qr.svg is missing. The QR plugin did not run.");
}

if (process.env.PINPOINT_SKIP_GLASSES_BUILD !== "1") {
  console.log("[build-app] building the glasses app in device mode…");
  const result = spawnSync("npm", ["run", "build:device"], {
    cwd: glassesRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) fail("The glasses device build failed.");
}

if (!existsSync(path.join(glassesDist, "index.html"))) {
  fail("apps/glasses/dist-even/index.html is missing. Build the glasses app first.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(glassesDist, output, { recursive: true });

// The phone browser can open /app/ too, but it is the install target, not a
// search result. Even Hub ignores this tag.
const indexPath = path.join(output, "index.html");
const html = readFileSync(indexPath, "utf8");
if (!html.includes('name="robots"')) {
  writeFileSync(indexPath, html.replace("<head>", '<head>\n    <meta name="robots" content="noindex">'));
}

console.log(`[build-app] copied the glasses build to ${path.relative(process.cwd(), output)}`);
