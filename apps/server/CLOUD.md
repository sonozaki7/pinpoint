# Pinpoint Cloud server (`PINPOINT_MODE=cloud`)

Public sample-workspace server for real Even G2 installs. It needs no laptop,
T3 Code, Telegram bot or API keys. It never contacts T3 or Telegram, never
calls a splitter/LLM, and ignores every `T3_*`, `TELEGRAM_*` and `SPLITTER_*`
environment variable.

## Run in production

```bash
cd apps/server
npm ci --omit=dev           # tsx is a runtime dependency, so this is enough
PINPOINT_MODE=cloud \
PINPOINT_HOST=127.0.0.1 \
PINPOINT_PORT=8787 \
PINPOINT_TRUST_PROXY=1 \
PINPOINT_SAMPLE_REPLY_MS=5000 \
WHISPER_MODEL=/models/ggml-base.en.bin \
WHISPER_THREADS=4 \
npm run start:cloud
```

`npm run start:cloud` only runs `tsx src/index.ts`; AWS/Compose/Kubernetes
style environments can pass the same variables directly. Put nginx (or the
platform proxy) in front of `127.0.0.1:8787` for HTTPS. Set
`PINPOINT_TRUST_PROXY=1` in that case so the rate limiter uses the first
`X-Forwarded-For` hop; leave it `0` when clients connect directly.

`WHISPER_MODEL` must point at a readable whisper.cpp ggml model (or leave it
empty and let the server find/download `ggml-base.en.bin`). whisper-cli writes
its temporary audio under `PINPOINT_DATA_DIR` (default `apps/server/.data`),
so give the process a writable data folder.

Deploy the repo root, not just `apps/server`: the sample workspace and its
fixture decks are read from `demo/sample/workspace.json` and `demo/fixtures/`.

## What a device sees

Every request except `GET /api/health` and `OPTIONS` must carry
`X-Pinpoint-Device: <uuid>`. The glasses generate one random UUID on first run
and keep it in SDK storage. Each UUID gets a private sample workspace:

- Inbox order comes from `demo/sample/workspace.json` (`login-fix`,
  `payment-upgrade`, `inbox-morning`); decks are the verified fixture decks, so
  every thread is ready immediately.
- Saving a review, sending it, the inbox status and the sample agent's reply are
  all scoped to that UUID. Sending a review removes the thread; after
  `PINPOINT_SAMPLE_REPLY_MS` (default 5000 ms) the agent replies under the same
  title as a report, and that reply has its own 1–4 point deck.
- `POST /api/sample/reset` (204) restores the three starting threads and
  cancels a pending reply.

State is intentionally **in memory**: restarting the process wipes every
device back to the sample workspace. Keep one process; there is no shared
store yet. The device store keeps at most 5,000 workspaces (least recently
used is dropped) and treats a device idle for 7 days as new.

## Limits

- 300 requests/min per IP and 120 requests/min per device, with `Retry-After`.
- JSON bodies up to 64 KB; voice bodies up to 960,000 bytes (30 s PCM).
- Voice: whisper-cli only, 2 concurrent transcriptions, queue wait up to 20 s
  (then 503 + `Retry-After`), 20 voice requests/min per device.
- `PINPOINT_SCRIPTED_TRANSCRIPTS` still works when explicitly set (recording
  helper), otherwise voice is real whisper.cpp.

The phase-2 desk-pairing seam is the per-device router in
`src/cloud/workspace.ts`; today it always returns a sample workspace.
