import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // Static assets (fonts, cut-outs, video, favicon, CNAME) stay in apps/site.
  publicDir: fileURLToPath(new URL("../site", import.meta.url)),
  resolve: {
    alias: {
      // The cloud sample-reply module is shared with the server; only its
      // randomUUID call is Node-specific, so it gets a browser shim.
      "node:crypto": fileURLToPath(new URL("./src/sim/crypto-shim.ts", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: "127.0.0.1", port: 4175, strictPort: true },
});
