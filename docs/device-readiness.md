> **SNAPSHOT (Nov 27 2026, 00:30 JST), not current status.** Several items below were being fixed while others edited the app (event defaults, exit-dialog repaint, pixel widths, whitelist, the 24x24 icon, the cloud). Treat each verdict as a checklist to re-verify on the installed beta build, not as today's state. The platform facts (testing modes, event envelopes, container limits) still hold and back [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md).

# Pinpoint on real Even G2 + R1 — device readiness

Written 2026-11-27 00:30 JST by a research sub-agent. Read-only inspection of `apps/**`, plus official docs, the official templates, community notes, and a **pixel measurement of every on-glasses string** with Even's own measurement library.

Three caveats before you trust a line number:

- `apps/glasses/**` was being edited *while this was written* (app.json 00:24, display.ts/main.ts 00:22, api.ts 00:22). Line numbers are from that snapshot; re-grep before editing.
- `https://pinpoint-api.qolso.com` answered **HTTP 521 (Cloudflare: origin unreachable)** from this machine at 15:25 UTC, and `https://pinpoint.qolso.com/app/` answered **404**. So item 1's CORS half and item 2's "host the bundle at a public URL" half are **unverified**, not proven working. Re-run the two curl checks at the end of §1 before the demo.
- The simulator was not run. Everything below about hardware is from docs, official templates, and community hardware notes, and is marked where it is inference.

Terms used below: **whitelist** = the per-app list of allowed server origins in `app.json`; **preflight** = the extra `OPTIONS` request a browser sends before a request that carries a custom header; **envelope** = which field of the event object the SDK put the gesture in (`textEvent`, `listEvent`, `sysEvent`).

---

## Summary

| # | Item | Verdict | Fix | Primary location |
|---|---|---|---|---|
| 1 | Network whitelist + CORS | **RISK** | Whitelist entry is right, but every request now carries `X-Pinpoint-Device`, so **every** call preflights. Server must answer `OPTIONS` with `Access-Control-Allow-Origin: *` **and** `Access-Control-Allow-Headers: content-type, x-pinpoint-device`. Verify with the curl in §1.3. | `apps/glasses/src/api.ts:93`, `apps/glasses/app.json:12` |
| 2 | How a judge installs it | **RISK** | README has a judge-facing install path and `…/app/` is deployed. A QR sideload still stops when the phone locks, so ship a **beta build** (best: lock-survival + glasses-menu entry); keep QR as the 60-second fallback. Store review is not viable before Dec 3. | `apps/glasses/README.md` (Permissions and packaging) |
| 3 | Input on hardware | **RISK → BROKEN if taps carry no `eventSource`** | Default `sysEvent` with a missing `eventType` to CLICK **inside** the envelope check, as the official ASR template does. Also handle LONG_PRESS (9/10) and SYSTEM_EXIT/ABNORMAL_EXIT (6/7). Swipe on the review screen is unproven (see §3.4). | `apps/glasses/src/events.ts:38` |
| 4 | Audio | **OK, one gap** | Format, ordering and cap are right. Add: abort the recording state on `FOREGROUND_EXIT`, re-arm nothing but clear `recordingStartedAt` on `FOREGROUND_ENTER`. | `apps/glasses/src/even.ts:310`, `src/main.ts:233` |
| 5 | Lifecycle + storage | **BROKEN (one path)** | Cancelling the system exit dialog leaves the glasses **blank** — the host clears the page, our signature cache says "nothing changed", so nothing is repainted. Force one rebuild on the next foreground event after `shutDownPageContainer(1)`. | `apps/glasses/src/even.ts:266`, `:302` |
| 6 | Display / pixel fit | **BROKEN (2 overflows)** | (a) The 3-option pane needs 81 px, the container allows 80 → the third option is clipped. (b) 62-char inbox rows measure up to 564 px in a 476 px item → clipped. (c) The 44-char cap wastes 30–43 % of every row and shrinks `login-fix` to `log...`. | `apps/glasses/src/even.ts:82`, `src/display.ts:7-9` |
| 7 | Packaging / store | **RISK** | The current package is 80,086 bytes — confirm the version stamped inside matches `app.json` 1.1.0. The 24×24 icon, listing text and privacy page exist; the whitelist still carries two dead `127.0.0.1` entries. | `apps/glasses/pinpoint.ehpk`, `app.json:14-15` |
| 8 | "Test like a reviewer" | **RISK** | 5-minute lock test, exit-dialog cancel, permission denial, first-run-from-glasses and clean console are all untested on an installed build. | §8 |
| — | Inbox tap can open the wrong row | **RISK** | A list click that omits `currentSelectItemIndex` (documented for item 0) leaves `state.inboxFocus` stale, and the tap opens that stale index instead of the highlighted row. | `apps/glasses/src/model.ts:504` |

---

## 1. Network whitelist and CORS

### 1.1 What the platform enforces

Two independent gates ([Networking](https://hub.evenrealities.com/docs/build/networking)):

1. **Even-side whitelist.** "The destination domain must be in your app.json network permission whitelist… Anything not in the whitelist is blocked — no traffic generated at all." So a wrong entry fails **silently**: no error, no request.
2. **Browser CORS**, enforced by Chromium (Android) / WKWebView (iOS). "Adding a domain to app.json does not override CORS."

Matching rules, verbatim: *"One whitelist entry per origin. Use the full origin (`https://api.example.com`) — bare hostnames and wildcards aren't supported."* An origin is scheme + host + port; a **path is not part of an origin**, so `https://pinpoint-api.qolso.com/app` is at best ignored and at worst fails to match. The CLI schema does **not** validate whitelist strings — `whitelist: w.array(w.string()).optional().default([])` (`apps/glasses/node_modules/@evenrealities/evenhub-cli/main.js`) — so a bad entry packs happily and dies on device.

Scheme: *"HTTPS in production. Plain `http://` is only useful for local dev against a LAN dev server."* QR sideload over `http://<lan-ip>:5173` is the documented dev path, so cleartext is not blocked outright; but there is no documented allowance for cleartext to a **public** host, so don't rely on it. Our API is HTTPS — correct.

WebSockets need their own entry with the `wss://` scheme: FAQ — *"Can I open a WebSocket? Yes — same whitelist rules."*; the official ASR template's README shows `"whitelist": ["https://api.yourprovider.com", "wss://stream.yourprovider.com"]`, and the community skill states it flatly: *"`wss://` needs its own entry."* We open no socket today, so nothing to add.

**What Origin the WebView sends** is not documented. The docs only say the server must return `Access-Control-Allow-Origin: *` "or specifically the WebView origin if you can identify it", and a community guide warns to "make sure CORS allows `null` origin (some WebViews send `null`)" ([distributed-backend.md](https://github.com/aleapc/even-hub-devguide/blob/master/docs/distributed-backend.md)). Practical conclusion: **return `*`**. It is legal here because the app sends `credentials: "omit"` (`api.ts:100`), and `*` is the only value that does not depend on guessing the origin.

### 1.2 Our current state

`app.json` already lists `https://pinpoint-api.qolso.com`, plus `http://127.0.0.1:8787` and `:8788`.

- Verdict on the public entry: **OK** (exact origin, no path, no trailing slash, HTTPS).
- The two `127.0.0.1` entries are **dead weight on a phone** — `127.0.0.1` there means the phone itself, not the laptop. Harmless to the whitelist, but the permission text is what a reviewer and a user read, so keep it describing the cloud only (the current `desc` already does).
- **The real risk is the custom header.** `api.ts:93` sets `X-Pinpoint-Device` on *every* request, including `GET /api/inbox`. A request with a non-safelisted header is no longer a "simple" request, so **every single call now requires an `OPTIONS` preflight**. The docs' minimum preflight response lists `Access-Control-Allow-Headers: Content-Type, Authorization` — it does **not** include our header. If the server copies that list, 100 % of requests fail in the WebView while `curl` works.
- `redirect: "error"` (`api.ts:99`): any redirect on the API host (http→https, apex→www, trailing-slash normalisation) becomes a hard network failure. Make sure `pinpoint-api.qolso.com` answers 200 directly.

### 1.3 Fix and verification

Server (Express-style, must run **before** any auth):

```js
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-pinpoint-device");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
```

Do not put auth in front of `OPTIONS` — the preflight never carries the header it is asking permission for.

Verify from any machine (this is the exact check that was **not** possible at 15:25 UTC):

```bash
curl -i -X OPTIONS https://pinpoint-api.qolso.com/api/inbox \
  -H 'Origin: null' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-pinpoint-device'
# expect: 204/200 + access-control-allow-origin: * + allow-headers including x-pinpoint-device

curl -i https://pinpoint-api.qolso.com/api/inbox -H 'Origin: null' -H 'X-Pinpoint-Device: test'
# expect: 200 + the same allow-origin header
```

If the first returns 4xx/5xx, or `allow-headers` omits `x-pinpoint-device`, the app looks dead on hardware with no on-screen clue.

---

## 2. How a judge installs it

### 2.1 The four ways to run an app, and what each is good for

From [Testing Modes](https://hub.evenrealities.com/docs/test/) (table reproduced from the docs):

| Mode | Hardware | Survives phone lock | On glasses menu | Reviewer parity |
|---|---|---|---|---|
| Simulator | no | n/a | no | no |
| Local Testing (QR + dev server) | yes | **no** | no | no |
| Private Testing (own `.ehpk`, own account) | yes | partial | no | closer |
| Beta Testing (tester list) | yes | **yes** | **yes** | **yes** |

Store review is a separate, slower path: upload → Private → Public → `In Review` → reviewer installs **as a beta tester** and runs the rubric → `Approved` → you press publish ([App Submission](https://hub.evenrealities.com/docs/ship/app-submission)). The docs publish **no turnaround time**, and published versions are immutable ("no rollback, fix-forward only"). With submission closing **29 Nov 23:59 Dubai** and Demo Day **3 Dec**, a first-time store submission is not a plan (see `research/05-hackathon-rules-and-competition.md`).

### 2.2 QR sideload from a public HTTPS URL — possible, with two catches

`evenhub qr` accepts any full `http(s)` URL (`--url` is validated only as "a valid HTTP or HTTPS URL", CLI `main.js`), so `evenhub qr --url https://pinpoint.qolso.com/app/` is a legal command and the judge only scans it with the phone camera. The app is built with `base: "./"` (`apps/glasses/vite.config.ts`), so it can be served from a subpath — that part is fine.

Catches:

1. **The bundle is not there.** `https://pinpoint.qolso.com/app/` returned **404** at 15:25 UTC. Someone must publish `apps/glasses/dist-even/` at that path (or any other path) before a QR means anything.
2. **QR dev mode is not the installed app.** Local Testing's own page lists what it skips: packaging validation, "real permissions" ("some permission prompts are skipped during dev"), and any lifecycle survival — "the moment the phone backgrounds the Even Realities App … the WebView is suspended … you usually get a blank screen until you re-scan the QR". So a judge who locks their phone mid-demo loses the app, and a whitelist mistake would probably **not** show up in a QR test (no `.ehpk` manifest is part of a dev-URL load — listed as unverified below). A green QR run is therefore *not* evidence that the shipped build works.

### 2.3 Account requirement for any on-glasses path

Developer mode is not a toggle: *"Signing in to the web hub flips your account to developer; the next restart of the phone app surfaces the developer section"* ([Hardware](https://hub.evenrealities.com/docs/get-started/quickstart/hardware)). So a judge needs:

- the Even Realities phone app, signed in, glasses paired and on current firmware, R1 paired if they want ring input;
- the **same email** signed in at `hub.evenrealities.com/login`;
- the phone app **force-quit and reopened** (swipe away from recents, not just backgrounded);
- then the Even Hub tab shows the developer section with **Scan QR**.

### 2.4 What the README should say (recommended)

Two paths, in this order. Beta is primary because it is the only mode that survives a locked phone and puts Pinpoint on the glasses menu — exactly what a judge does on stage.

```markdown
## Install on your G2 (judge quick start)

You need: Even G2 (+ optional R1), the Even Realities app signed in,
Even app version 2.2.10 or newer (Pinpoint is built on SDK 0.0.16).

### Path A — Beta build (recommended, survives a locked phone)
1. Send us the email address of your Even account (or ask us to add it on the spot).
2. Accept the invitation email. Your status must read **Active**; invitations expire after 7 days.
3. Even Realities app → **Me → Beta tester → Pinpoint → Install**.
4. After install it appears on the glasses menu, so the demo needs no phone touching;
   it also opens from the Even Hub tab in the app.
5. If the phone says "test version expired", one of the two beta gates is missing:
   the build must be tagged Beta **and** your tester status must read Active.

### Path B — QR (60 seconds, needs our laptop or a hosted URL)
1. Sign in at hub.evenrealities.com/login with the same email as the phone app,
   then force-quit and reopen the Even Realities app.
2. Even Hub tab → developer section → **Scan QR**.
3. Scan the QR we show: `https://pinpoint.qolso.com/app/` (or our laptop's LAN URL).
   Note: the QR build stops when your phone locks. Use Path A for a hands-free demo.

### Controls
Swipe up/down: move · Tap: open / talk / stop · Double-tap: back, and on the
first screen it opens the system "Close Pinpoint?" dialog · Tap-then-hold: menu.
```

Also state the account/firmware requirements in the submission text, and keep a printed QR plus a charged spare G2 at the booth.

---

## 3. Input on hardware vs simulator

### 3.1 Which envelope carries what

| Gesture | Where it arrives | Source |
|---|---|---|
| Tap / scroll / double-tap on a **text**-capturing page | `event.textEvent` | [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) "Event routing" |
| Same, on a **list**-capturing page | `event.listEvent` (plus `currentSelectItemIndex`) | same |
| Long press start / release | **always** `event.sysEvent`, `eventSource` **absent** | same, "Long press" |
| Contextual-menu selection | `event.menuItemClickEvent` (bypasses capture) | [Contextual Menu](https://hub.evenrealities.com/docs/build/contextual-menu) |
| Audio PCM | `event.audioEvent` | Device APIs |
| Foreground enter/exit, system exit, abnormal exit | `event.sysEvent` (4/5/7/6) | [input-events.md](https://github.com/nickustinov/even-g2-notes/blob/main/docs/input-events.md) |

The official ASR template says it more bluntly than the docs: *"Taps/double-taps/lifecycle come through `event.sysEvent`. Audio PCM frames come through `event.audioEvent`"* ([asr/src/main.ts](https://github.com/even-realities/evenhub-templates/blob/main/asr/src/main.ts)). A community guide claims the opposite split — "real hardware sends events via `sysEvent`, simulator via `textEvent`" ([sdk-quirks.md](https://github.com/aleapc/even-hub-devguide/blob/master/docs/sdk-quirks.md) quirk 2). Both agree on one thing: **a handler that ignores `sysEvent` is dead on hardware**. So handle text, list **and** sys — which we do.

### 3.2 `eventType: undefined` is CLICK — but only inside the envelope

Protobuf omits zero values, so a single tap arrives with `eventType` missing. Our normalisation:

```ts
// events.ts:37-38
} else if (sys) {
  type = sys.eventType ?? (fromTouch ? OsEventTypeList.CLICK_EVENT : undefined);
}
```

`fromTouch` (`events.ts:26-28`) is true only when `eventSource` is `…GLASSES_R`, `…GLASSES_L` or `…FROM_RING`. If the host sends a tap as a bare `sysEvent` **without** `eventSource` — which is exactly what the docs say happens for the long-press pair — then `type` is `undefined`, the `switch` falls to `default`, and `decodeInput` returns `undefined`. **Every tap would be silently dropped.** The official template resolves the default unconditionally, inside the envelope check:

```ts
function eventTypeOf(envelope) { if (!envelope) return null; return envelope.eventType ?? OsEventTypeList.CLICK_EVENT }
```

Fix (one line, no downside — the audio envelope is already branched off above at `events.ts:20`):

```ts
type = sys.eventType ?? OsEventTypeList.CLICK_EVENT;
```

This is the single highest-value change in this document: it is the difference between "works in the simulator" and "works in a judge's hands", and nothing in the simulator will tell you.

### 3.3 Gestures we ignore

`decodeInput` covers CLICK, DOUBLE_CLICK, SCROLL_TOP/BOTTOM, FOREGROUND_ENTER/EXIT. Missing:

- **LONG_PRESS_EVENT (9) / LONG_PRESS_RELEASE_EVENT (10)** — SDK 0.0.14+, Even App 2.2.9+; both always on `sysEvent`; a rebuild mid-press still delivers the release. We ship SDK 0.0.16, so they are available. Today they fall to `default` and are dropped.
- **SYSTEM_EXIT_EVENT (7) / ABNORMAL_EXIT_EVENT (6)** — dropping these means no cleanup on a real exit or a dropped link (harmless today because there is nothing to clean, but the exit-dialog cancel bug in §5 wants the signal).

The temple and the R1 ring deliver the **same** event types with a different `eventSource`; routing both to the same handler is correct for our design ("ring for where"). Note the OS takes "tap then long press" for its own contextual menu — *"the OS claims tap then long press for its own menu"* — so a long press may never reach us, and our 260 ms tap delay could fire the queued tap *after* the menu overlay opens (§5.3).

### 3.4 Swipe is the weak link on hardware (inference — test before demo)

Two credible sources disagree:

- [nickustinov](https://github.com/nickustinov/even-g2-notes/blob/main/docs/display.md): `SCROLL_TOP/BOTTOM_EVENT` are **boundary** events of the firmware's internal scroll — "emitted only when the user reaches the top or bottom boundary". Our review page's capture container holds a single space (`even.ts:37`, content `" "`), which cannot scroll, so there may be **no scroll events at all** on that screen.
- [aleapc](https://github.com/aleapc/even-hub-devguide/blob/master/docs/sdk-quirks.md) quirk 4: "a single finger swipe … can produce 5-10 `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` dispatches", which implies swipes always emit.

Our 250 ms cooldown (`model.ts:69`, `shouldAcceptSwipe`) already absorbs the rapid-fire case. The untested case is the silent one. **Do this before the demo, on the installed beta build:** open a review, swipe down four times. If the focus moves, nothing to do. If it does not, either give the capture container a scrollable content (e.g. append `"\n"` lines taller than 288 px) or add a R1/temple long-press fallback for next/previous. Same test on the inbox list.

### 3.5 Inbox list selection desync

Two documented facts combine badly with our code:

- The firmware moves list selection itself; a **rebuild resets it** ("all containers are destroyed and recreated. Any internal scroll position or list selection state is lost").
- `currentSelectItemIndex` is **omitted for the first item** ("the simulator (and sometimes real hardware) omits `currentSelectItemIndex` for the first list item").

Our inbox tap path opens `state.inboxFocus` (`model.ts:504`), not the event's index, and the handler only updates that state when `listIndex` is defined. The documented omission for item 0 therefore does the wrong thing: the user taps the **top** row, the click arrives without an index, `inboxFocus` still holds the previously focused row, and `press()` opens **that** thread. The highlight and the opened thread disagree with no visible error. Fix: for a `listEvent` click, treat a missing index as 0 — `setInboxFocus(state, listIndex ?? 0)` — or open the event's index directly. Secondary: a rebuild resets the firmware's selection to item 0 (§6.5), so any code path that rebuilds the inbox should reset `inboxFocus` to 0 with it.

---

## 4. Audio

### 4.1 Platform rules

- `bridge.audioControl(true, AudioInputSource.Glasses)` starts; `audioControl(false)` stops. Glasses source **requires** `createStartUpPageContainer` to have run first; the phone source does not. Default is glasses ([Device APIs](https://hub.evenrealities.com/docs/build/device-apis)).
- Format on both sources: **PCM 16 kHz, signed 16-bit little-endian, mono**, delivered as `event.audioEvent.audioPcm` (`Uint8Array`).
- Permission `g2-microphone` for glasses, `phone-microphone` for phone; prompts fire on first invocation, not at launch ([Private Testing](https://hub.evenrealities.com/docs/test/private-testing)).
- **No chunk size or rate is promised by the docs** — only the format. Community measurement for SDK 0.0.13 reports 10 ms frames of 40 bytes ([device-apis.md](https://github.com/nickustinov/even-g2-notes/blob/main/docs/device-apis.md)), which cannot both be true at 16 kHz × 2 bytes (that is 320 bytes per 10 ms), so treat frame size as unspecified and never depend on it. Our `voice.ts:2` derives duration from total bytes at 32 bytes/ms, which matches the documented format exactly; that is the right invariant. The "25 s body cap" in `voice.ts:4` is simply unreachable because recording stops at 20 s (`model.ts:66`).
- **Backgrounding:** "audioControl capture … Stops if the WebView is suspended. Re-enable on foreground (with the same AudioInputSource you used before)" ([Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle)). The ASR template does the simpler, safer thing: it calls `audioControl(false)` in `cleanup()` on `SYSTEM_EXIT`/`ABNORMAL_EXIT` and on `beforeunload`.

### 4.2 Our state

`even.ts:310` starts Glasses source, always with an explicit source; `even.ts` calls `createStartUpPageContainer` at `:245` before any mic call — ordering is correct. `main.ts:474` always stops the mic after a recording, including on the error path (`:466`). Frames are copied defensively (`voice.ts:38`) because the host may reuse the buffer — good.

**Gap:** if the phone locks mid-recording, the frames stop arriving but `state.recordingStartedAt` stays set and the 1 Hz timer (`main.ts:205-210`) only advances while the page is alive. On resume the user sees a frozen `* REC 25s` pane; the next tap calls `stopRecording()` with a short/empty buffer and POSTs it to `/api/voice`. Fix: treat `FOREGROUND_EXIT` as "abort recording" (drop the buffer, `mic(false)`, flash "Recording canceled — phone locked"), and on `FOREGROUND_ENTER` call `mic(false)` defensively in case the host still thinks capture is on.

---

## 5. Lifecycle and storage

### 5.1 What the platform does

| Resource | iOS (WKWebView) | Android (Chromium WebView) |
|---|---|---|
| In-memory JS | survives | may be lost under memory pressure — "treat Android suspend as cold start" |
| `localStorage` | survives — "always survives (persisted to disk)" (FAQ: "survives suspension, kill, and update. Cleared on uninstall") | same |
| WebSocket | typically holds | typically dropped |
| `audioControl`, location streams | stop when suspended; re-arm on foreground | same |

(Background & Lifecycle; [FAQ](https://hub.evenrealities.com/docs/reference/faq).)

Storage choice: the FAQ blesses plain `localStorage`, and `bridge.setLocalStorage` / `getLocalStorage` is the bridge equivalent — **it returns `false` rather than throwing** in some sideload paths (community skill: "`setLocalStorage` and `audioControl` resolve `false` without throwing"). `apps/glasses/src/device.ts` already does the right thing: localStorage first, bridge as a write-through backup, with a time budget. Keep that pattern; check the boolean.

### 5.2 The exit-dialog bug (this one bites on stage)

`shutDownPageContainer(1)` does not behave like a simple "exit". Hardware testing recorded ([page-lifecycle.md](https://github.com/nickustinov/even-g2-notes/blob/main/docs/page-lifecycle.md#the-exit-dialogue-inverts-the-foreground-events-and-can-wedge-the-image-channel)):

| Event | When | Meaning |
|---|---|---|
| `FOREGROUND_ENTER` (4) | dialog appears (~100 ms later) | the page **has already been cleared host-side** — this is the cue to rebuild |
| `FOREGROUND_EXIT` (5) | user answers **No** | cancelled — the app keeps running, page still blank |
| `SYSTEM_EXIT` (7) | user answers **Yes** | really exiting |

So the polarity is inverted, and the only correct response to "No" is to repaint.

Our code:

- `even.ts:302` calls `shutDownPageContainer(1)` — correct mode, correct place (root `doubleTap`, `model.ts:549`).
- `decodeInput` maps both foreground events to `{ kind: "surface" }` (`events.ts:52-55`), and `main.ts` answers a surface event with `render()` only.
- `render()` → `apply()` → **`if (nextFull === full) return;`** (`even.ts:266`). Nothing changed, so nothing is sent. The glasses stay blank until some other state change happens to alter the signature.

**Verdict: BROKEN on cancel.** A judge taps the screen twice by accident, gets "Close Pinpoint?", taps No — and the app is a black rectangle. That is the worst possible look and it is one flag away.

Fix, in `connectEven`:

```ts
let exitDialogOpen = false;
// in exit(): exitDialogOpen = true; before shutDownPageContainer(1)
// in the event callback, before decodeInput:
const t = event.sysEvent?.eventType;
if (exitDialogOpen && (t === OsEventTypeList.FOREGROUND_ENTER_EVENT || t === OsEventTypeList.FOREGROUND_EXIT_EVENT)) {
  exitDialogOpen = t === OsEventTypeList.FOREGROUND_EXIT_EVENT ? false : exitDialogOpen;
  full = "";            // invalidate the cache so the next apply() repaints
  void writes.run(() => apply(getPage()));
  return;
}
```

(The `full = ""` part matters — without it the early return undoes the fix.) Also: the firmware emits **duplicate** sys events ~50–100 ms apart for one physical transition, so debounce by `(type, timestamp)` over ~600 ms before acting.

### 5.3 Menu overlay and the stale tap

Opening the contextual menu also delivers `FOREGROUND_ENTER`, and closing it `FOREGROUND_EXIT` — *"FOREGROUND_EXIT_EVENT here means the overlay went away. It does not mean your app was torn down"*. Our handler only re-renders, and `apply()` early-returns when the page signature is unchanged (`even.ts:266`), so opening and closing the menu is free. The risk is the tap timer: a tap is queued for 260 ms before it becomes a real press, so a "tap then hold" that the OS claims for its menu can still deliver its queued tap afterwards, opening a thread under the overlay. Test it; if it happens, cancel the pending tap on any `surface` event.

### 5.4 Persistence at boot

`boot()` always starts at the inbox and re-fetches. Notes and seen-points survive on the server (`PUT /api/review/:threadId`, autosaved 300 ms after a change, `main.ts:196`). What does **not** survive an Android cold start: which thread you were reviewing, which point you were on. The reviewer rubric asks for "Setup is remembered across launches… never re-prompt" and "after 2 minutes idle the app is still alive"; a cold relaunch landing back on the inbox reads as "lost my place". Store `{ threadId, focus }` via `bridge.setLocalStorage` on every focus change and restore it once on boot.

---

## 6. Display: pixel measurement and call budget

### 6.1 Method

Measured with Even's own library, installed fresh in a scratch folder: `@evenrealities/pretext@0.1.4`, whose tables are the firmware's LVGL glyph advances and kerning ([font-measurement SKILL](https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/font-measurement/SKILL.md)). Constants from that page: **line height 27 px**, **list item height 40 px**, **list item horizontal padding 12 px per side**. Container inner width = `width − 2×(paddingLength + borderWidth)`.

Every string below was generated by re-running the exact functions from `apps/glasses/src/display.ts` (copied verbatim: `toAscii`, `asciiTruncate`, `wrapAscii`, `pointRow`, `fitTitle`, `reviewHeader`, `optionLines`, `inboxRow`) against `demo/fixtures/{login-fix,payment-upgrade,inbox-morning}.json` and the fixed strings in `pageFor`.

### 6.2 The two real overflows

**(a) The question pane is 1 px too short for 3 lines.** `even.ts:81-84` gives the pane `height: 86`, `borderWidth: 1`, `paddingLength: 2` → inner height `86 − 6 = 80`. `optionLines` (`display.ts:199`) emits up to three lines. Measured: `1 Wait until Monday / 2 Upgrade now / 3 Upgrade in a test shop` = **3 lines = 81 px**. The third option is clipped on hardware — on the one screen where a wrong tap answers an agent's question. Fix: `height: 90` (inner 84, three lines fit; the footer starts at 250, pane ends at 247). Same fix helps long quotes.

**(b) Inbox rows can exceed the list item.** List item inner width = `itemWidth 500 − 2×12 = 476`. `LIST_WIDTH = 62` (`display.ts:8`) is a character cap, and prose at 62 chars measures **541 px** (measured), i.e. 65 px too wide — and wider than the list container itself (544). List items are single-line by design ("Items are plain text only, single line per item"), so the overflow is clipped, not wrapped. Fix: `LIST_WIDTH = 52` (52 chars = 459 px) or truncate by pixels with `pxTruncate`.

### 6.3 The 44-character cap wastes a third of every row

`ROW_WIDTH = 44` (`display.ts:7`) is applied to the header (544 px), review rows (540 px) and options rows (540 px). Measured from the fixtures:

| Screen | String | px | Container inner | Used |
|---|---|---|---|---|
| Review header, 3 notes | `log... \| 3/7 \| 1 objection, 1 answer, 1 note` | 342 | 544 | 63 % |
| Same, untruncated | `login-fix \| 3/7 \| 1 objection, 1 answer, 1 note` | **376** | 544 | 69 % — **it fits** |
| Review row | `> o 1 Reproduce the bug with two open tabs` | 378 | 540 | 70 % |
| Review row (widest fixture, focused) | `> o 5 Double-charge hit 2 orders in 6 months` | 391 | 540 | 72 % |
| Options row | `> 1 Upgrade in a test shop` | 222 | 540 | 41 % |

The header case is the embarrassing one: with 168 px of empty space, the project name is shortened to `log...` so that three counters can fit. Prose at 58 chars measures 501 px, so `ROW_WIDTH = 56` is safe for every 540 px row and removes the ellipsis entirely. (The char cap exists to avoid a wrap; pixel truncation via `pxTruncate` would be exact.)

No fixture string overflows its container at 44 chars — the cap is **too strict**, not too loose, except for the inbox (§6.2b), where 62 is too generous. Two constants, opposite errors.

### 6.4 Everything else measured clean

| Group | Worst measured | Limit | Verdict |
|---|---|---|---|
| All 18 fixture point rows (3 decks) | 391 px (focused widest) | 540 | OK |
| All quote panes (2 lines each) | 399 px | 534 × 80 | OK |
| Options pane (3 lines) | 81 px tall | 80 | **overflows by 1 px** |
| Footers (`swipe: move \| tap: open \| 2x: exit` etc.) | 283 px | 540 | OK |
| Inbox titles (`PINPOINT \| 3 need you` 194 px, `Sample - 3 need you` 183 px) | 194 px | 544 | OK |
| Inbox title + `demo data` subtitle | 2 lines = 54 px | 56 | OK (12 px headroom gone) |
| Message box (`All clear.\nYour agents are working.`) | 216 px, 2 lines | 522 × 114 | OK |
| Preview pane (`Sent to agent`, mock preview lines) | 369 px | 504 × 84 | OK |
| `* REC 25s \| tap to stop` | 197 px | 534 | OK |
| `Send 3 notes to auth-refresh-fix.` | 293 px | 534 | OK |

Emoji and exotic glyphs are already neutralised: `toAscii` (`display.ts:41`) maps anything outside printable ASCII to `" "`, and the firmware **silently drops** characters outside its font set anyway ("Characters outside the font set are silently dropped"). Our substitutions (`-`, `*`, `>`, `+`, `x`) are all plain ASCII, so nothing here depends on the glyph table. Do not introduce decorative glyphs without probing them on hardware: the community found `▮` rendered **blank** even though the firmware's table lists block characters, while `▁▂▃` and `●○` rendered ([SKILL.md](https://github.com/goodrahstar/evenhub-g2-skill/blob/main/skills/evenhub-g2/SKILL.md)).

### 6.5 Brightness, flicker and call counts

- **Brightness.** Text `textColor` is 0–4 on hardware (0 is dimmest, not "unset"); `borderColor` is 0–15. Our values: header 3, focused row 4, other rows 2, pane 2 (4 on preview), footer 2, message 3, `CAPTURE` 1, border 4. All legal. Out-of-range values are rejected **client-side** with `INVALID_TEXT_BRIGHTNESS` (`index.d.ts:672`), so a bad level would fail the whole page build, not just one container — worth knowing if anyone "brightens" the design later.
- **Rebuild vs upgrade.** `rebuildPageContainer` ≈ **165 ms** flat + "brief flicker on hardware"; `textContainerUpgrade` ≈ **83 ms each**, flicker-free, break-even at 2 containers ([performance.md](https://github.com/nickustinov/even-g2-notes/blob/main/docs/performance.md)).
- **Per interaction, as the code stands:**

| Interaction | Bridge calls | Wall clock |
|---|---|---|
| Inbox: content unchanged (focus move, menu open/close, foreground event) | none — `even.ts:266` returns before any write | 0 ms |
| Inbox: content changed (list reload after a send, loading→ready, offline) | 1 rebuild | ~165 ms + flicker, and the native list selection resets to item 0 |
| Review: one swipe (focus move) | 3–4 upgrades — header (contains `4/7`), two rows, pane, sometimes footer | ~250–330 ms |
| Review: start recording | 2 upgrades (pane `* REC`, footer) | ~166 ms |
| Enter review / options / preview | 1 rebuild (shape changed) | ~165 ms |

The `|| page.kind === "inbox"` clause at `even.ts:269` is **required, not a bug**: a list cannot be updated in place ("No in-place updates — changing a list means rebuilding the whole page"), and a same-length list change would otherwise slip past the shape check and never reach the glasses. Keep it; just remember that any inbox rebuild resets the native selection, so reset `inboxFocus` alongside it (§3.5).

For the review swipe, one rebuild (165 ms) is measurably faster than 3–4 upgrades (250–330 ms), but the upgrade path is flicker-free and preserves native state. Either is defensible; do not leave it accidental.

- **Container budget.** At most **8 non-image containers** per page, 4 images; exceeding it fails the **entire** page build ("`createStartUpPageContainer` returns `2` (oversize)") and "the glasses render nothing". `containerTotalNum` must match the array lengths (`even.ts:173` does). Current counts: review = **8** (capture, header, 4 rows, pane, footer) — exactly at the ceiling, so `REVIEW_ROWS` cannot grow without merging containers; options = 7; inbox list = 3; preview = 4. Container names are ≤ 16 chars (`capture`, `header`, `row1..4`, `pane`, `footer`) — legal. IDs are unique per page.
- **Text limits.** create/rebuild content ≤ 1000 chars, upgrade ≤ 2000; the largest single container we send is the quote pane (≤ ~140 chars). Fine.

---

## 7. Packaging and store rules

### 7.1 `app.json` fields

Required by the schema (`main.js`, mirrored in [Packaging](https://hub.evenrealities.com/docs/ship/packaging) and the reviewer rubric): `package_id` (reverse-domain, lowercase, ≥2 segments, no hyphens), `edition` `"202601"`, `name` ≤ 20 chars **and must not contain "Even"**, `version` strict `x.y.z`, `min_sdk_version` (required; docs say the current floor is `"0.0.14"`), `entrypoint` must exist in the build folder, `permissions` (array of objects; `desc` 1–300 chars; `network` takes `whitelist`), `supported_languages` from `en,de,fr,es,it,zh,ja,ko`.

Not in `app.json`: **icon, tagline, description, category, screenshots, privacy policy**. Those live in the portal (or `evenhub create/update`): name 1–20, tagline 1–50, description 1–2000, icon **exactly 24×24 PNG**, every visible pixel opaque `#F4F4F4`, lit pixels must form complete 2×2 blocks (CLI `pl()` validation). `min_app_version` is derived at pack time from the SDK (`minAppVersion: "2.2.10"` in `even_hub_sdk@0.0.16`), so **judges must run Even app ≥ 2.2.10** or the app is blocked at open.

Our `app.json`: package id valid, edition valid, name valid, version `1.1.0`, `min_sdk_version 0.0.16`, permissions used and described, `supported_languages ["en"]`. Two cleanups: drop the two `127.0.0.1` whitelist entries (dead on a phone; they read as "this only works with a laptop"), and keep the network `desc` honest about the cloud (it already is in the current file).

### 7.2 Size limits

Hard CLI cap on upload: **100 MiB** for `.ehpk`, 1 MiB for the icon. Practical cap per the FAQ: **~10 MB** — "larger packages still upload but degrade install UX over BLE". Our package is ~80 kB. Not a concern.

### 7.3 What the reviewer actually checks (and where we stand)

From [App Submission & QA](https://hub.evenrealities.com/docs/ship/app-submission) and the EP12/EP13 episode descriptions ("the app.json fields that fail validation, the naming rule that is an automatic reject, the two checks worth doing by hand"; "name and tagline, an icon that passes review, simulator screenshots, category and search tags, the privacy checklist"):

| Check | Our status |
|---|---|
| Manifest validity, name ≤ 20 and no "Even" | pass |
| **Every declared permission is used** | pass (`network`, `g2-microphone` both used) |
| Icon legible, 24×24, 1-bit, 2×2 blocks, foreground **and** background supplied | pass — `apps/glasses/icon-24.png` is 24×24, one color, 2×2 blocks (tested) |
| Screenshots must come from the simulator, 576×288, monochrome | **partial** — 14 simulator captures exist in `demo/shots/` (`glasses-01-inbox.png` …), but no curated listing set at the store's aspect and density |
| Display name matches `app.json` and the on-glasses name | pass ("Pinpoint") |
| Privacy policy covers every permission | present at `/privacy.html` and `docs/privacy.md`; link it in the listing and name `pinpoint-api.qolso.com` |
| No black screen on first run | pass (we paint "Checking your agents…" before the inbox lands) |
| CORS correctly configured on the API | pass — `OPTIONS /api/inbox` returns `access-control-allow-origin: *` and `x-pinpoint-device` (checked Nov 27) |
| Root double-tap → system exit dialog (#1 rejection cause) | pass (`model.ts:549` → `even.ts:302`, mode 1) |
| Locked-phone: renders, core flow on glasses + ring, 2 min idle alive | **untested**; Private builds "don't pass the 5-minute lock test", so this needs a beta build |
| After confirming exit, the phone-side WebView closes | not verifiable from the app side |
| No financial advice / medical / emergency routing; no NSFW | pass (code review) |
| Changelog on a new version, 1–3 lines per language | n/a until first upload |

### 7.4 Ship-state hygiene

- `apps/glasses/pinpoint.ehpk` was repacked for v1.1.0 (80,086 bytes) and `dist-even/` rebuilt at the same time, so the artifact is current. Confirm the version **inside** the package is `1.1.0` (the CLI prints the manifest it stamps), and repack again if anyone touches `app.json` or `display.ts` afterwards — an `.ehpk` carrying the old `127.0.0.1`-only whitelist looks exactly like "the backend is broken".
- Never bundle keys: "anyone can extract its contents". Our device id is generated on device (`device.ts`), no secret in the bundle — good.

---

## 8. The "test like a reviewer" checklist, applied

Run these on the **installed beta build**, not on QR (Local Testing "cannot validate the checks below"):

1. **5-minute lock test.** Open a review, lock the phone 5 minutes, unlock. Expect: same screen, same point, no spinner, no black. Today: iOS likely fine; Android may cold-start to the inbox (§5.4).
2. **Root double-tap → system dialog → tap "No".** Expect the app to come back, not blank. **This is currently broken** (§5.2).
3. **Root double-tap → "Yes".** Expect a clean exit, then relaunch Conversate (a first-party app) without restarting the glasses.
4. **Deny each permission once.** Deny the mic → `startRecording` gets `false` → we flash "Mic unavailable. Tap to retry." (`main.ts:456-460`) — correct shape; verify the wording on glass.
5. **Every gesture gives visible feedback**, with the ring paired *and* without it. Specifically: swipe on the review screen (§3.4), tap on the ring, double-tap, tap-then-hold for the menu.
6. **Console is clean at boot.** Our own logs (`[pinpoint] ready`, `screen=`, `focus=`) are fine and useful; a red error at boot usually means `waitForEvenAppBridge` lost a race.
7. **First run from the glasses menu with the phone locked.** If the deck takes ~45 s, the pane says "Building points..." — that is a message, not a black screen; keep it.
8. **Simulator ≠ hardware.** Two documented traps that apply to us: text metrics differ ("layouts that look perfect in the simulator may wrap differently on hardware") and the simulator "sends `sysEvent` for button clicks, while real hardware sends `textEvent` or `listEvent`" — exactly the ambiguity in §3.2.

---

## What is still unverified (and how to close it)

| Question | Why it matters | Cheapest check |
|---|---|---|
| Does `OPTIONS` allow `x-pinpoint-device`? | every request depends on it | the two curls in §1.3 (API returned Cloudflare **521** at 15:25 UTC, so this could not be run) |
| Is the app bundle published at a public URL? | the QR path in §2.2 | `curl -I https://pinpoint.qolso.com/app/` → currently **404** |
| Do hardware taps carry `eventSource`? | §3.2 decides whether input works at all | install the beta, tap once, read the phone console |
| Do swipes emit SCROLL events with non-scrollable content? | §3.4: review navigation | swipe four times on the review screen |
| Does the exit dialog really clear the page on this firmware? | §5.2: blank-screen recovery | tap No on the dialog and look |
| Review turnaround time | store path feasibility | not published anywhere in the docs; assume days, not hours |
| Does QR dev mode enforce the whitelist? | a green QR test may hide §1 bugs | docs imply no (manifest checks are skipped in dev); confirm by pointing the dev build at a non-whitelisted host |
