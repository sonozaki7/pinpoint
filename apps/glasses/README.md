# Pinpoint — Even G2 app

Review your AI agents' replies and plans on Even G2, point by point. **Ring for where, voice for what.** Built for the Heads Up hackathon (Even Realities × TVM Ventures), simulator-first.

A packaged device build talks to **Pinpoint Cloud** (`https://pinpoint-api.qolso.com`) out of the box, so the glasses work on a phone with no laptop nearby. Browser and simulator builds still talk to the local demo/live server. If the server cannot be reached, the glasses show a short offline screen with tap-to-retry instead of silently switching to sample data. `?mock=1` forces the in-memory demo. This folder started from the MIT-licensed Agent Relay scaffold (see `PRIOR_WORK.md`); its SDK wrapper, event normalization and simulator patterns were reused.

## Cloud and local servers

The server choice lives in `src/api.ts`:

| Build | Default server |
| --- | --- |
| Device (`MODE=evenhub`, used by `npm run pack`) | `CLOUD_URL` from `shared/contract.ts` |
| Browser / simulator (`npm run dev`) | `http://127.0.0.1:8787` |
| Either, with `VITE_PINPOINT_SERVER` set | that URL (local cloud mode, LAN preview, staging) |

Every request carries `X-Pinpoint-Device` on the cloud. On first run the app makes a UUID v4, stores it with the SDK's `setLocalStorage` (mirrored to `window.localStorage` as a fast cache), and reuses it on later runs. A missing or slow host storage wait is capped at 450 ms, so the first screen is never held.

Local demo servers installed before the cloud contract do not allow that header in CORS. The app tries it once, then continues without it for that session; the cloud always requires it.

When `GET /api/health` reports `mode: 'cloud'` and `workspace: 'sample'`, the inbox header becomes `Sample - N need you`, the hold menu gains `Reset sample`, an empty inbox says `All clear. Hold for menu: Reset sample`, and after a send the app polls the inbox every 2 s for 14 s so the sample agent's `report` reply appears by itself.

The phone page shown by the Even app is a production page: app name and purpose, connection and server version, plain-language gestures, `Reset sample workspace`, `Retry connection`, the privacy note, and the version. The old preview buttons and `?mock=1` switch live in the collapsed **Developer controls** section. It follows the phone's light/dark scheme and uses no external fonts or CDNs.

Lifecycle: the SDK's `FOREGROUND_ENTER`/`FOREGROUND_EXIT` events (and `document.visibilitychange` as a fallback) refresh the inbox on return and stop an in-flight recording cleanly, including the microphone.


## Screens and gestures

| Screen | Gesture | Result |
| --- | --- | --- |
| Inbox (root, native list) | Swipe up/down | Move the native list selection |
| | Tap | Open the focused thread |
| | Double-tap | **`shutDownPageContainer(1)`** — the required system exit dialog |
| | Hold menu | `Agree & send` on a non-question row (send without opening), `Refresh`, plus `Reset sample` in the cloud sample workspace |
| Review | Swipe up/down | Move the point focus; the four-row window scrolls in place |
| | Tap a step/claim/draft point | Start a voice note (it stops after 1.2 s of silence, 30 s maximum); tap again to stop early |
| | Tap a question | Open Options |
| | Tap the `> Send · 1 change, 6 OK` row | Start the 5 s undo countdown |
| | Double-tap | Back to Inbox (draft kept and autosaved) |
| | Hold menu | `Send review` (same countdown), `Read on phone`, `Clear notes`, `Refresh`, plus `Reset sample` in the sample workspace |
| Options | Tap | Choose an option; the last answer starts the countdown by itself, or `Say something else` to record |
| | Double-tap | Back to Review |
| Countdown | Tap | Undo the send and return to the review |
| Receipt | Tap | Return to the inbox before the automatic 2 s |

Opening a deck starts on its first flagged line (or line 1), and a question-first deck opens straight on its options with the recommended first option focused. After a note the cursor moves to the next flagged line or the Send row, so nobody scrolls to find Send. The send row names the destination: `Send to Priya · 1 change` for a mail draft, `Post 1 comment` / `Approve` for a Notion page, and `Send · 1 change, 6 OK` for an agent.

Rows are words, not a legend of symbols. The focused row is the only one with a `>` cursor and is drawn at brightness 4; every other row stays at brightness 2 and keeps a three-space indent aligned with the cursor. A row the user commented on ends with a right-aligned word: `CHANGE` for an objection, `NOTE` for a note, `CHANGED` for a draft sentence the server rewrote, or the chosen option for a question. A row the assistant flagged (high risk or a `flag`) ends with `CHECK` until the user comments. Nothing else is added.

The header reads `login-fix · 4 of 7 · 1 change · 1 note` (counts are omitted while zero and the title is shortened first). The quote pane shows the focused point's quote, the question's options, `Now: ...` after a draft edit, or `You said: ...` after a note. Footers stay in words: `Tap: talk · Double-tap: back`, `Tap: undo` while counting down, and `Tap: open · Hold: menu` on the inbox. Long strings are fitted with the firmware's own glyph widths (the `@evenrealities/pretext` tables) rather than a fixed character count, so `login-fix` is never cut while a long inbox row still stops before the list edge.

## Run the browser preview

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/?mock=1` (or just `http://127.0.0.1:4173/`; an unreachable server falls back to demo data). The page mirrors the 576 × 288 glasses canvas and has buttons for swipe, tap, double-tap and the hold menu, plus keyboard arrows, Enter, Escape and Backspace. The header shows `demo data` whenever the in-memory demo is active.

### Official Even Hub simulator

The check below runs against a real Pinpoint server in demo mode, on port 8788 so it never collides with another server on the default 8787. Run terminal 2, 3 and 4 from this folder (`apps/glasses`):

```sh
# terminal 1 — the real server, demo fixtures, real /api/voice
cd ../server
PINPOINT_MODE=demo PINPOINT_PORT=8788 npm start

# terminal 2 — the glasses dev server pointed at it
VITE_PINPOINT_SERVER=http://127.0.0.1:8788 npm run dev

# terminal 3 — the official simulator, without ?mock=1
npm run simulator -- "http://127.0.0.1:4173/" --automation-port 9898 --aid coreaudio:BuiltInMicrophoneDevice

# terminal 4 — drive the full flow and save screenshots
node scripts/check-simulator.mjs 9898 --server http://127.0.0.1:8788
```

The script verifies the demo server has the current fixtures, then runs: inbox → open `login-fix` (lands on flagged point 4) → voice note → the cursor moves to Send → tap Send → 5 s undo countdown → receipt → inbox with the thread gone → open the payment question (lands on its options) → choose an answer → countdown → root double-tap exit. PNGs are written to `demo/shots/glasses-01-inbox.png` … `glasses-13-exit.png`. (The live-server script still describes the older preview flow; the mock flow above is exercised by `npm run test:ui`.)

The voice note is real audio: the script makes the phrase with macOS `say`, plays it through the speakers while the simulator records from the MacBook microphone selected with `--aid`, and the server transcribes the captured PCM through its own `/api/voice` route. Keep the Mac's output audible and the microphone unmuted for this check; it is a real room recording, not injected bytes. The script also decodes each review screenshot and proves the focused row's peak alpha is 255 against 197 for the dim rows, so the brightness difference is in the saved PNG, not only in the DOM.

**Simulator caveat:** version 0.9.5 accepts `shutDownPageContainer(1)` and blanks the glasses framebuffer, but does not draw the system exit dialog itself (the app logs `[pinpoint] exit-dialog`). The same call is asserted through a mocked host by `npm run test:ui`. A Vite hot reload can leave the next startup page rejected; restart the simulator after code changes.

## Data and voice

- `VITE_PINPOINT_SERVER` sets the server origin. Without it, a device build uses Pinpoint Cloud and a dev/simulator build uses `http://127.0.0.1:8787`. `?mock=1` forces the in-memory demo.
- Device builds send `X-Pinpoint-Device`, a per-install UUID v4 kept in SDK storage; the cloud uses it to keep a private sample workspace per device.
- `?mock=1` and the demo server use the plain-language fixtures in `demo/fixtures`: `login-fix` (plan, 7 steps, risky step 4), `payment-upgrade` (question with three options) and `inbox-morning` (report, 6 points). They are imported at build time, not fetched.
- In the cloud sample workspace a send triggers a sample-agent `report` reply after about 5 s; the app polls for it and shows it without a manual refresh.
- After a successful send the app hides that thread locally. The demo server keeps its static fixtures, so without this filter the thread would come back on the next inbox refresh; the filter is cleared by a page reload, and it is not used in the cloud sample workspace (the sample agent may reuse the thread).
- Voice: tap starts `audioControl(true, AudioInputSource.Glasses)`, PCM frames are buffered, and a second tap (or 20 s) stops the mic and POSTs the raw s16le 16 kHz mono bytes to `/api/voice`. The `no / don't / not / wrong / instead / stop / never` heuristic picks `x` versus `*`; a question answer uses `=`. The simulator check feeds real speech through the host microphone; the demo-mode server transcribes it for real (T3's transcription endpoint in the check run).
- Every change to notes or seen points is autosaved with `PUT /api/review/:threadId`.

## Permissions and packaging

`app.json` requests:

- **network** — whitelists Pinpoint Cloud first (`https://pinpoint-api.qolso.com`), plus `http://127.0.0.1:8787` and `:8788` for simulator development. For a LAN device preview, add the Mac's LAN origin and set `VITE_PINPOINT_SERVER` to it.
- **g2-microphone** — records the short voice note about the focused point; the audio is transcribed, then discarded.

```sh
npm run pack   # writes pinpoint.ehpk (SDK 0.0.16)
npm run icon   # writes icon-24.png (24x24, 1-bit) and the 4x brand preview
```

`icon-24.png` is the Hub store icon, not part of the package: exactly 24×24, every visible pixel opaque `#F4F4F4`, and every lit pixel starting a complete 2×2 block (the CLI's `pl()` check). Upload it with `evenhub create … --icon icon-24.png` or `evenhub update --icon icon-24.png`; `app.json` does not carry an icon field.

## Checks

```sh
npm test          # tsx --test: focus, four-row window, word labels, pixel fitting, exit repaint, icon, cloud API
npm run build     # tsc --noEmit + vite build
npm run test:ui   # 320–1440 px preview + mocked SDK transport, exit mode 1
```

The UI check needs Google Chrome or Playwright Chromium (`npx playwright install chromium`). The simulator check needs the simulator running with `--automation-port`, a demo server (pass its URL with `--server`), and macOS `say`/`afplay`/`ffmpeg` for the real voice note.

## Known limits

- Simulator-only: no BLE timing/flicker, no ring-vs-temple distinction, brightness levels are indicative, and the system exit dialog is not drawn (see caveat above).
- Real-hardware risks: the simulator cannot prove the phone's network reachability, cloud CORS, SDK storage behaviour across app restarts, or that the Even app keeps the WebView alive while the phone is locked. The packaged build is bounded by the `app.json` network whitelist and SDK `0.0.16`.
- The simulator check exercises the real server in demo mode on port 8788, including `/api/voice`; live T3 threads and real Telegram delivery belong to the server-side checks.
- One fixed firmware font; strings are normalised to printable ASCII plus `·` and fitted to the measured pixel width of each container.
