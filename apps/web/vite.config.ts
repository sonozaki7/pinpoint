import { fileURLToPath, URL } from "node:url";
import qrcode from "qrcode-generator";
import { defineConfig, type Plugin } from "vite";
import { privacyPlugin } from "./build/privacy";

/** The installed glasses build the QR code opens. */
const G2_APP_URL = "https://pinpoint.qolso.com/app/";
const QR_PATH = "media/g2-qr.svg";

/**
 * The G2 install code, generated at build time (and served in dev) instead of
 * shipping a hand-made image that can drift from the real URL. A pure-JS
 * encoder keeps this off the client bundle.
 */
function g2QrPlugin(): Plugin {
  const svg = (): string => {
    const code = qrcode(0, "M");
    code.addData(G2_APP_URL);
    code.make();
    return code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  };
  return {
    name: "pinpoint-g2-qr",
    configureServer(server) {
      server.middlewares.use(`/${QR_PATH}`, (_req, res) => {
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(svg());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: QR_PATH, source: svg() });
    },
  };
}

export default defineConfig({
  base: "./",
  // Static assets (fonts, cut-outs, video, favicon, CNAME) stay in apps/site.
  publicDir: fileURLToPath(new URL("../site", import.meta.url)),
  plugins: [g2QrPlugin(), privacyPlugin()],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: "127.0.0.1", port: 4390, strictPort: true },
});
