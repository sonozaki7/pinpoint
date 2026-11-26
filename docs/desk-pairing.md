# Desk pairing: use your own computer from the glasses

Pinpoint normally needs a server on your computer (the **desk**) to reach T3
Code, Notion and Gmail. A phone on a mobile network cannot reach a laptop on
your home network, and the Even G2 app's network allowlist only permits
`pinpoint-api.qolso.com`. Desk pairing closes that gap: the desk dials **out**
to Pinpoint Cloud, and the cloud relays the paired device's requests back down
the same connection. The cloud never stores inbox, deck, review or voice
content.

## The 30-second version

1. On your computer, in `apps/server`:

   ```bash
   npm run desk
   ```

   The first run creates `.data/desk.json` with a random desk secret in a
   mode-600 file, starts the normal Pinpoint server (live mode by default), and
   prints a pairing code such as `K7Q4-2MXP`. The code is valid for ten minutes
   and works once.

2. In the Pinpoint phone page, open **Connect your computer**, type the code,
   and press **Connect**. The page stores a device token and reloads the inbox.
   The glasses header shows your computer's name instead of "Sample".

3. The phone now sends `X-Pinpoint-Token` on every request. The cloud checks
   the token, finds the paired desk, and forwards the raw request over the
   desk's WebSocket. The desk answers with its own in-process HTTP app.

4. **Disconnect** in the phone page, or `npm run desk -- --unpair-all` on the
   computer, revokes the pairing. The device falls back to its private sample
   workspace.

```text
phone ──HTTPS──▶ Pinpoint Cloud ──WSS (desk dials out)──▶ desk on your computer
        request relay                              local Pinpoint API
        ◀──────────── response ──────────────────── T3 / Notion / Gmail
```

## What each side stores

| Where | What | Lifetime |
|---|---|---|
| Cloud memory | SHA-256 of each desk secret; desk display name | until the cloud process restarts |
| Cloud memory | SHA-256 of each device token, device UUID, desk binding | until unpair or cloud restart |
| Cloud memory | SHA-256 of each live pairing code and its 10-minute expiry | ten minutes or one use |
| Desk disk | `.data/desk.json`: secret + name, mode 600 | until you delete the file |
| Phone | device UUID and desk token in Even SDK storage + localStorage | until Disconnect or app storage is cleared |
| Cloud request bodies | only inside one in-flight relay promise | milliseconds; never logged or written |

The cloud never parses or keeps an inbox, deck, note, draft, email or audio
body. It logs only the route template, HTTP status, duration and an 8-character
device hash — no query strings, bodies or full credentials.

## Security model

- **Desk authentication.** The desk opens
  `GET /api/desk/connect` with `Authorization: Bearer <deskSecret>`. The secret
  is 32 random bytes generated on first run. The cloud hashes it with SHA-256
  and uses that hash as the desk id; the raw secret is never stored, logged or
  returned. A connection without a well-formed bearer value gets HTTP 401
  before the WebSocket upgrade completes.
- **One live socket per desk.** Reconnecting with the same secret replaces the
  old socket (close code 4001). This makes restarts clean, and prevents two
  copies of the desk from both answering.
- **Pairing codes.** 8 characters from a 31-symbol alphabet with no `0/O` or
  `1/I/L` (about 40 bits), displayed as `XXXX-XXXX`. A code expires after ten
  minutes and is deleted on first successful use. Asking for a new code
  invalidates the previous one. At most five attempts are allowed per device
  and per IP in any ten-minute window; extra attempts get HTTP 429 with
  `Retry-After`. Codes and tokens are stored hashed.
- **Device tokens.** 32 random bytes, returned once from `POST /api/pair`,
  stored by the cloud as SHA-256, and bound to both the device UUID and the
  desk. Pairing the same device again replaces its old token. A token used with
  a different device UUID is ignored and the device sees the sample workspace.
- **Relay limits.** Only `/api/*` paths are forwarded, so the cloud cannot ask
  the desk for arbitrary URLs or files. Request and response bodies are capped
  at 2 MB each way, the desk answer times out after 65 s, and the desk offloads
  unknown routes to its normal 404 handler. The cloud strips the device token
  before relaying: the desk sees the request as if it came from its own app.
- **Offline behaviour.** If the desk is not connected, relayed requests return
  HTTP 503 `Your desk is offline. Start Pinpoint on your computer.` The pairing
  is kept, so a reconnect starts working again without re-pairing.
- **Cloud restart.** Desks and tokens are in memory by design. After a cloud
  restart every device is "unpaired" and falls back to the sample workspace;
  pair again with a fresh code. This also means a stolen cloud disk cannot
  contain working credentials.

### Threat notes

- **The cloud is in the data path and terminates TLS.** It can see request and
  response bytes while they are in flight, even though it never stores them.
  This is not end-to-end encryption; a compromised cloud process could read a
  review or an inbox response. The trade-off is what makes the phone-to-laptop
  path possible at all. Cloudflare and nginx also terminate their own TLS hops.
  Production uses `https://`, so the desk socket is `wss://`; use `http://` and
  `ws://` only for a localhost test.
- **A token is a bearer credential.** Anyone who copies the token *and* the
  device UUID from the phone could act as that device until it is unpaired.
  Tokens are not scoped to an IP or user agent. Disconnect and re-pair if a
  phone is lost; the desk secret does not need to change.
- **A pairing code is a short-lived bearer secret.** Five tries per ten minutes
  and a single-use ten-minute code make online guessing impractical, but a
  shoulder-surfed code should be treated as compromised: ask for a new one, or
  unpair-all after pairing.
- **The desk trusts the cloud connection.** A valid desk secret can send API
  requests to the desk's local app. The relay client only accepts `/api/` paths
  and caps bodies, so the blast radius is the same API the local glasses use,
  not the shell or the filesystem. Keep the secret file private (mode 600).
- **DoS surface.** The cloud caps live desks at 5,000 and pairing codes/tokens
  at a bounded number; pairing attempts are rate-limited. The WebSocket server
  also has a 6 MB incoming frame limit.
- **Nothing is encrypted at rest on the phone.** The token sits in the WebView's
  storage, like the device id; the Even host sandbox is the boundary.

## Commands

Run these in `apps/server`:

```bash
npm run desk                 # normal live server + relay; prints a code
npm run desk -- --pair       # ask the running desk for a fresh code
npm run desk -- --unpair-all # revoke every device paired to this desk
```

`--pair` and `--unpair-all` talk to the running desk through a small local
request file in `.data/`, so they never open a second cloud socket and never
kick the live desk offline. If no desk is running, `--unpair-all` opens one
short-lived socket just to revoke the pairings; `--pair` asks you to start the
desk first (the startup code is the one to use).

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PINPOINT_CLOUD_URL` | `https://pinpoint-api.qolso.com` | Cloud base URL; `http://` becomes `ws://` locally |
| `PINPOINT_DESK_NAME` | the computer's short hostname | Name shown on the phone/glasses |
| `PINPOINT_MODE` | `live` for the desk | `demo` runs the fixture workspace, useful for local tests |
| `PINPOINT_DATA_DIR` | `apps/server/.data` | Where `desk.json` and the other server data live |
| `PINPOINT_PORT` | `8787` | Local server port (not exposed to the phone) |

The local server still enforces the usual live-mode privacy gate: set
`T3_PROJECTS` to the projects Pinpoint may read.

## Protocol (for maintenance)

The desk connects once and exchanges JSON text frames.

Cloud → desk:

```jsonc
{ "type": "request", "request": { "id": "...", "method": "GET", "path": "/api/inbox",
  "query": "", "contentType": "...", "bodyBase64": "..." } }
{ "type": "pair-code", "id": "...", "code": "K7Q4-2MXP", "expiresAt": "..." }
{ "type": "unpaired", "id": "...", "removed": 1 }
{ "type": "error", "id": "...", "error": "..." }
```

Desk → cloud:

```jsonc
{ "type": "hello", "name": "so-MacBook" }
{ "type": "request-pair-code", "id": "..." }
{ "type": "response", "response": { "id": "...", "status": 200,
  "contentType": "application/json", "bodyBase64": "..." } }
{ "type": "unpair-all", "id": "..." }
```

The cloud never logs frame contents. The desk prints relay lines with the
method, route, status and duration, and never the body.

## Troubleshooting

| Symptom | Check |
|---|---|
| Phone says "Your desk is offline" | Is `npm run desk` still running and connected? The terminal prints `[desk] connected`; the phone's Disconnect/Connect is not needed. |
| Code rejected | Codes last ten minutes, work once, and a newer code replaces an older one. Run `npm run desk -- --pair` for a fresh code. |
| Code rate-limited (429) | Wait ten minutes; the limit is per device and per IP. |
| Cloud restarted | Pair again. Desks and tokens are deliberately memory-only. |
| Two desks fight | Use one `npm run desk` per secret. A second connection replaces the first (close 4001); the replaced process stops retrying and says so. |
| Local test | Run the cloud on port 8799 and the desk with `PINPOINT_MODE=demo PINPOINT_CLOUD_URL=http://127.0.0.1:8799 PINPOINT_PORT=8798 npm run desk`. |
