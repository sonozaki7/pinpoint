# Pinpoint — Even G2 app

Review your AI agents' replies and plans on Even G2, point by point. **Ring for where, voice for what.** Built for the Heads Up hackathon (Even Realities × TVM Ventures), simulator-first.

The app talks only to the Pinpoint server (`apps/server`). With no server it falls back to a deterministic in-memory demo, so the whole flow works standalone. This folder started from the MIT-licensed Agent Relay scaffold (see `PRIOR_WORK.md`); its SDK wrapper, event normalization and simulator patterns were reused.

## Screens and gestures

| Screen | Gesture | Result |
| --- | --- | --- |
| Inbox (root, native list) | Swipe up/down | Move the native list selection |
| | Tap | Open the focused thread |
| | Double-tap | **`shutDownPageContainer(1)`** — the required system exit dialog |
| | Hold menu | `Refresh` |
| Review | Swipe up/down | Move the point focus; the four-row window scrolls in place |
| | Tap a step/claim/draft point | Start a voice note; tap again to stop |
| | Tap a question | Open Options |
| | Tap the `> Send review (N notes)` row | Open Preview |
| | Double-tap | Back to Inbox (draft kept and autosaved) |
| | Hold menu | `Send review`, `Read on phone`, `Clear notes`, `Refresh` |
| Options | Tap | Choose an option and return to Review, or `Say something else` to record |
| | Double-tap | Back to Review |
| Preview | Tap | Send to the agent, then `Sent to agent` for 1.5 s and back to Inbox |
| | Double-tap | Back to Review |

Rows use ASCII markers: `o` unseen, `+` agreed (seen), `x` objection, `*` note, `?` question unanswered, `=` answered, and `!` before a high-risk point. The focused row is drawn at brightness 4 with a leading `>` cursor; every other row stays at brightness 2 and keeps a two-space indent. The review header uses words instead of cryptic counters: `auth-refresh-fix | 4/7 | 1 objection` (the counters are omitted while zero, and the title is shortened first so the line never exceeds 44 characters). The quote pane shows the exact quote, or the question's options, wrapped to at most three 44-character lines.

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

The script verifies the server reports `mode=demo` with four threads, then runs: inbox → open `auth-refresh-fix` → point 4 → voice note → Send row → Preview → Send → inbox with the thread gone → Options for `deps-upgrade` → choose an answer → root double-tap exit. PNGs are written to `demo/shots/glasses-01-inbox.png` … `glasses-13-exit.png`.

The voice note is real audio: the script makes the phrase with macOS `say`, plays it through the speakers while the simulator records from the MacBook microphone selected with `--aid`, and the server transcribes the captured PCM through its own `/api/voice` route. Keep the Mac's output audible and the microphone unmuted for this check; it is a real room recording, not injected bytes. The script also decodes each review screenshot and proves the focused row's peak alpha is 255 against 197 for the dim rows, so the brightness difference is in the saved PNG, not only in the DOM.

**Simulator caveat:** version 0.9.5 accepts `shutDownPageContainer(1)` and blanks the glasses framebuffer, but does not draw the system exit dialog itself (the app logs `[pinpoint] exit-dialog`). The same call is asserted through a mocked host by `npm run test:ui`. A Vite hot reload can leave the next startup page rejected; restart the simulator after code changes.

## Data and voice

- `VITE_PINPOINT_SERVER` sets the server origin (default `http://127.0.0.1:8787`). `?mock=1` forces the in-memory demo.
- Demo mode implements the SPEC §5 API in memory with the four §12 threads: `auth-refresh-fix` (plan, 7 steps, risky step 4, mutex step 6), `deps-upgrade` (question with three options), `inbox-morning` (4 drafts) and `flaky-e2e` (failed run).
- After a successful send the app hides that thread locally. The demo server keeps its static fixtures, so without this filter the thread would come back on the next inbox refresh; the filter is cleared by a page reload.
- Voice: tap starts `audioControl(true, AudioInputSource.Glasses)`, PCM frames are buffered, and a second tap (or 20 s) stops the mic and POSTs the raw s16le 16 kHz mono bytes to `/api/voice`. The `no / don't / not / wrong / instead / stop / never` heuristic picks `x` versus `*`; a question answer uses `=`. The simulator check feeds real speech through the host microphone; the demo-mode server transcribes it for real (T3's transcription endpoint in the check run).
- Every change to notes or seen points is autosaved with `PUT /api/review/:threadId`.

## Permissions and packaging

`app.json` requests:

- **network** — whitelists the server origins (`http://127.0.0.1:8787` and `:8788`). For a LAN device preview, add the Mac's LAN origin and set `VITE_PINPOINT_SERVER` to it.
- **g2-microphone** — records the short voice note about the focused point.

```sh
npm run pack   # writes pinpoint.ehpk (SDK 0.0.16)
```

## Checks

```sh
npm test          # tsx --test: focus, four-row window, markers, ASCII 44, notes, API
npm run build     # tsc --noEmit + vite build
npm run test:ui   # 320–1440 px preview + mocked SDK transport, exit mode 1
```

The UI check needs Google Chrome or Playwright Chromium (`npx playwright install chromium`). The simulator check needs the simulator running with `--automation-port`, a demo server (pass its URL with `--server`), and macOS `say`/`afplay`/`ffmpeg` for the real voice note.

## Known limits

- Simulator-only: no BLE timing/flicker, no ring-vs-temple distinction, brightness levels are indicative, and the system exit dialog is not drawn (see caveat above).
- The simulator check exercises the real server in demo mode on port 8788, including `/api/voice`; live T3 threads and real Telegram delivery belong to the server-side checks.
- One fixed firmware font; strings are normalised to printable ASCII and capped before sending.
