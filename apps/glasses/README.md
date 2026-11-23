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

Rows use ASCII markers: `o` unseen, `+` agreed (seen), `x` objection, `*` note, `?` question unanswered, `=` answered, and `!` before a high-risk point. The quote pane shows the exact quote, or the question's options, wrapped to at most three 44-character lines.

## Run the browser preview

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/?mock=1` (or just `http://127.0.0.1:4173/`; an unreachable server falls back to demo data). The page mirrors the 576 × 288 glasses canvas and has buttons for swipe, tap, double-tap and the hold menu, plus keyboard arrows, Enter, Escape and Backspace. The header shows `demo data` whenever the in-memory demo is active.

### Official Even Hub simulator

With the dev server running:

```sh
npm run simulator -- "http://127.0.0.1:4173/?mock=1" --automation-port 9898
```

Then, in another terminal, drive the full flow and save screenshots:

```sh
node scripts/check-simulator.mjs 9898
```

The script runs: inbox → open `auth-refresh-fix` → context menu → point 4 → record and stop a (scripted) voice note → Send row → Preview → Send → inbox → Options for `deps-upgrade` → choose an answer → root double-tap exit. PNGs are written to `demo/shots/glasses-01-inbox.png` … `glasses-13-exit.png`.

**Simulator caveat:** version 0.9.5 accepts `shutDownPageContainer(1)` and blanks the glasses framebuffer, but does not draw the system exit dialog itself (the app logs `[pinpoint] exit-dialog`). The same call is asserted through a mocked host by `npm run test:ui`. A Vite hot reload can leave the next startup page rejected; restart the simulator after code changes.

## Data and voice

- `VITE_PINPOINT_SERVER` sets the server origin (default `http://127.0.0.1:8787`). `?mock=1` forces the in-memory demo.
- Demo mode implements the SPEC §5 API in memory with the four §12 threads: `auth-refresh-fix` (plan, 7 steps, risky step 4, mutex step 6), `deps-upgrade` (question with three options), `inbox-morning` (4 drafts) and `flaky-e2e` (failed run).
- Voice: tap starts `audioControl(true, AudioInputSource.Glasses)`, PCM frames are buffered, and a second tap (or 20 s) stops the mic and POSTs the raw s16le 16 kHz mono bytes to `/api/voice`. Demo mode returns a scripted transcript. The `no / don't / not / wrong / instead / stop / never` heuristic picks `x` versus `*`; a question answer uses `=`.
- Every change to notes or seen points is autosaved with `PUT /api/review/:threadId`.

## Permissions and packaging

`app.json` requests:

- **network** — whitelists the server origin (`http://127.0.0.1:8787`). For a LAN device preview, add the Mac's LAN origin and set `VITE_PINPOINT_SERVER` to it.
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

The UI check needs Google Chrome or Playwright Chromium (`npx playwright install chromium`). The simulator check needs the simulator running with `--automation-port`.

## Known limits

- Simulator-only: no BLE timing/flicker, no ring-vs-temple distinction, brightness levels are indicative, and the system exit dialog is not drawn (see caveat above).
- No live server was available while building the glasses app; every flow was exercised against the in-memory demo. The HTTP client follows SPEC §5 and is ready for the server agent's implementation.
- One fixed firmware font; strings are normalised to printable ASCII and capped before sending.
