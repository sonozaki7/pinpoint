# Pinpoint Cloud server (`PINPOINT_MODE=cloud`)

Public server for real Even G2 installs. It needs no laptop, T3 Code, Telegram
bot or API keys. It never contacts T3 or Telegram, never calls a splitter/LLM,
and ignores every `T3_*`, `TELEGRAM_*` and `SPLITTER_*` environment variable.

It has two jobs:

1. Give every device a private **sample workspace**, so the app works before a
   computer is paired.
2. Relay a paired device's requests to that device's **desk** (the owner's
   computer running `npm run desk`) over a WebSocket the desk dials out.

See [docs/desk-pairing.md](../../docs/desk-pairing.md) for the user guide,
security model and wire protocol.

## Run in production

```bash
cd apps/server
npm ci --omit=dev           # tsx and ws are runtime dependencies
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

The nginx site must pass WebSocket upgrades for `/api/desk/connect`
(`proxy_http_version 1.1`, `Upgrade`/`Connection` headers). The deployed
`pinpoint-api.qolso.com` site already does.

`WHISPER_MODEL` must point at a readable whisper.cpp ggml model (or leave it
empty and let the server find/download `ggml-base.en.bin`). whisper-cli writes
its temporary audio under `PINPOINT_DATA_DIR` (default `apps/server/.data`),
so give the process a writable data folder.

Deploy the repo root, not just `apps/server`: the sample workspace and its
fixture decks are read from `demo/sample/workspace.json` and `demo/fixtures/`.

## What a device sees

Every request except `GET /api/health` and `OPTIONS` must carry
`X-Pinpoint-Device: <uuid>`. The glasses generate one random UUID on first run
and keep it in SDK storage.

### Unpaired (the default)

Each UUID gets a private sample workspace:

- Inbox order comes from `demo/sample/workspace.json` (`login-fix`,
  `payment-upgrade`, `inbox-morning`); decks are the verified fixture decks, so
  every thread is ready immediately.
- Saving a review, sending it, the inbox status and the sample agent's reply are
  all scoped to that UUID. Sending a review removes the thread; after
  `PINPOINT_SAMPLE_REPLY_MS` (default 5000 ms) the agent replies under the same
  title as a report, and that reply has its own 1–4 point deck.
- `POST /api/sample/reset` (204) restores the three starting threads and
  cancels a pending reply.
- `GET /api/health` returns `workspace: "sample"` and `pairing: true`.

### Paired to a desk

The phone stores a device token returned by `POST /api/pair` and sends it as
`X-Pinpoint-Token` on every request. The cloud then relays the raw request to
the paired desk instead of using the sample workspace:

- Relay requests and responses are opaque base64 bodies. The cloud never
  parses an inbox, deck, review, draft or voice clip, and never logs a body or
  query string.
- `GET /api/health` is answered by the cloud, not the desk, and returns
  `workspace: "desk"`, `pairing: true`, and
  `desk: { name, online }`.
- A desk that is not connected gives HTTP 503:
  `{ "error": "Your desk is offline. Start Pinpoint on your computer.",
  "code": "desk_offline" }`.
- An invalid or unknown token is ignored: the device simply keeps its sample
  workspace. This is what a device sees after a cloud restart.
- `DELETE /api/pair` revokes this device's token; no valid token means no-op.

The relay sits above the per-device sample router in `src/cloud/workspace.ts`;
paired requests never allocate a sample workspace.

## Pairing API

| Method & path | Body / headers | Result |
|---|---|---|
| `GET /api/desk/connect` | `Authorization: Bearer <deskSecret>` (WebSocket upgrade) | Desk socket; SHA-256 of the secret becomes its id |
| `POST /api/pair` | `{code}`, device header | `{ok, token, desk:{name}}` or `{ok:false,error}` |
| `DELETE /api/pair` | device header + `X-Pinpoint-Token` | `{ok:true}` |

Codes are 8 characters from an unambiguous alphabet, shown as `K7Q4-2MXP`,
valid for ten minutes, single use. Five attempts are allowed per device and
per IP per ten minutes; the sixth gets 429 with `Retry-After`. Codes and tokens
are stored as SHA-256 hashes only. Pairing a device again replaces its old
token.

## Limits

- 300 requests/min per IP and 120 requests/min per device, with `Retry-After`.
- JSON bodies up to 64 KB; voice bodies up to 960,000 bytes (30 s PCM).
- Relay: 2 MB request and 2 MB response, 65 s timeout, `/api/` paths only.
- Pairing: 5 attempts per device and per IP per 10 minutes; 5,000 live desks,
  5,000 live codes and 20,000 tokens are the in-memory caps.
- Voice for unpaired devices: whisper-cli only, 2 concurrent transcriptions,
  queue wait up to 20 s (then 503 + `Retry-After`), 20 voice requests/min per
  device. Paired devices transcribe on their own desk via the relay.
- `PINPOINT_SCRIPTED_TRANSCRIPTS` still works when explicitly set (recording
  helper), otherwise voice is real whisper.cpp.

## State and restarts

All cloud state is intentionally **in memory**:

- restarting the process wipes every sample workspace, desk registration,
  pairing code and device token;
- devices fall back to the sample workspace and must pair again with a fresh
  code;
- the desk's secret lives only on the desk (`apps/server/.data/desk.json`,
  mode 600), so the desk reconnects with the same identity, but the cloud
  treats it as a new desk.

Keep one process; there is no shared store. The sample device store keeps at
most 5,000 workspaces (least recently used is dropped) and treats a device idle
for 7 days as new.

## Logs

One line per HTTP request, e.g.:

```text
[cloud] GET /api/inbox 200 7ms device=bd7662a5
```

and desk lifecycle lines with a short desk hash:

```text
[desk] upgrade desk=2288fff8
[desk] online desk=2288fff8 online=1 total=1
[desk] offline desk=2288fff8 online=0
```

No bodies, transcripts, query strings, tokens, secrets or full IPs are logged.
