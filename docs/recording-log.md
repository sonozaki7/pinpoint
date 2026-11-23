# Pinpoint demo recording log — 2026-11-24

Final footage for the storyboard in `docs/DEMO.md`, recorded from the official
Even Hub simulator against the real Pinpoint server, plus one live T3 Code
review. Everything here was measured on this Mac. No token is stored in this
file.

## What changed for recording

- `apps/server` learned `PINPOINT_SCRIPTED_TRANSCRIPTS` (default
  `demo/fixtures/transcripts.json`): `/api/voice` returns the next unused
  canned note after 1.2 s. A client that sends `X-Point-Id` (optionally
  `X-Thread-Id`) gets the note for that point; otherwise notes are handed out
  in file order. Running out is an error, not a silent repeat. Tested in
  `apps/server/test/scripted-voice.test.ts` (9 tests).
- `apps/server` learned `PINPOINT_DECK_FIXTURE` for live recordings: one live
  thread id is pinned to a fixture deck so the recorded point order matches
  the storyboard. Quotes are still re-verified against the live source.
- `demo/fixtures/transcripts.json` holds the three notes:
  - `auth-refresh-fix` p4: "No. Don't log everyone out. Migrate the existing
    sessions instead."
  - `auth-refresh-fix` p6: "Use a request queue. A mutex deadlocks with the
    retry path."
  - `inbox-morning` p3: "Make it Thursday, not Tuesday."
- `demo/scripts/record-sim.mjs` now writes `<scene>.mp4`,
  `<scene>.timeline.json` and `<scene>-sheet.png` into `demo/recordings/`,
  probes each mp4 with ffprobe, and waits after stopping the mic long enough
  for the 1.2 s transcript to land on the focused point. `--record-name`
  renames a single-scene take. `demo/scripts/verify-fixtures.mjs` skips
  `transcripts.json`.

## Commands

Demo server (port 8788, fixed fixtures, scripted voice):

```sh
cd apps/server
PINPOINT_MODE=demo PINPOINT_PORT=8788 \
PINPOINT_DATA_DIR="$PWD/../../demo/shots/tmp/data-demo3" \
PINPOINT_SCRIPTED_TRANSCRIPTS="$PWD/../../demo/fixtures/transcripts.json" \
npm start
```

Glasses dev server + simulator:

```sh
cd apps/glasses
VITE_PINPOINT_SERVER=http://127.0.0.1:8788 npm run dev
npm run simulator -- "http://127.0.0.1:4173/" \
  --automation-port 9898 --aid coreaudio:BuiltInMicrophoneDevice
```

Recording (human pacing: 0.9 s per swipe, 1.5 s hold on risky point 4, 2 s
after the mic stops so the note lands before the next swipe):

```sh
node demo/scripts/record-sim.mjs --port 9898 --strict \
  --step-ms 900 --voice-ms 2600 --voice-stop-ms 2000
```

Live server (port 8789, only the `pinpoint` project is readable):

```sh
cd apps/server
PINPOINT_MODE=live PINPOINT_PORT=8789 T3_PROJECTS=pinpoint \
SPLITTER_PROVIDER=opencode \
PINPOINT_DATA_DIR="$PWD/../../demo/shots/tmp/data-live" \
PINPOINT_SCRIPTED_TRANSCRIPTS="$PWD/../../demo/fixtures/transcripts.json" \
PINPOINT_DECK_FIXTURE="$PWD/../../demo/recordings/live-auth-refresh-fix.deck.json" \
npm start
```

Real thread (the prompt is the fixture plan plus a "reply verbatim" wrapper,
passed on stdin so no shell quoting changes it):

```sh
~/.t3/bin/t3 thread start /Users/so/Desktop/Project/pinpoint - \
  --provider opencode --model opencode-go/deepseek-v4.1-flash \
  --title auth-refresh-fix --wait < /tmp/pp-auth-prompt.txt
```

The recorded thread is `mcp:0cc3681c-17ba-4d06-8a88-d9218fcd4d4e`
("auth-refresh-fix", project "pinpoint", completed).

Live recording (one scene, output renamed for the editor):

```sh
node demo/scripts/record-sim.mjs --port 9898 --scenes auth \
  --record-name live-hero --strict --step-ms 900 --voice-ms 2600 \
  --voice-stop-ms 2000
```

Export the T3 conversation (review + reply):

```sh
node demo/scripts/export-t3-thread.mjs \
  "mcp:0cc3681c-17ba-4d06-8a88-d9218fcd4d4e" \
  --out demo/recordings/t3-live-thread.json
```

## Scene durations (ffprobe)

All six clips are **1152×576, h264, yuv420p, 30/1 fps**, green-on-black,
2× nearest-neighbour, from 6.6–9.9 fps simulator frames.

| Clip | Duration | Size |
|---|---|---|
| `inbox.mp4` | 2.667 s | 45 KB |
| `auth.mp4` | 22.800 s | 463 KB |
| `inbox-after.mp4` | 1.933 s | 28 KB |
| `deps.mp4` | 8.167 s | 165 KB |
| `inbox-morning.mp4` | 16.100 s | 321 KB |
| `live-hero.mp4` | 22.800 s | 481 KB |

Demo total: 51.7 s of clips. The scene table now plans 51.8 s; the extra time
over the old 48.8 s plan is the 2 s post-mic wait on each note.

The hero clip's beats (`demo/recordings/auth.timeline.json`, ms from the first
frame): deck 1416, risky point 4 at 5426, objection beat 10030, mutex point
6 at 12146, note beat 16753, Send row 18757, preview 20358, send 21987.
The app header reads `auth-refresh-fix | 6/7 | 1 objection, 1 note`; preview
reports 1 objection, 1 note, 5 agreed. The p4 quote sits still for 1.5 s
before the mic opens.

## Live proof

- Thread: `mcp:0cc3681c-17ba-4d06-8a88-d9218fcd4d4e`, title
  `auth-refresh-fix`, project `pinpoint`.
- Open → tap Send: **20.39 s** (timeline: open at 17 ms, send at 20402 ms).
- Notes: **2** — p4 (objection, exact text above) and p6 (note, exact text
  above); points 1, 2, 3, 5, 7 agreed in silence.
- Preview counts: 1 objection, 1 note, 5 agreed.
- `sent t3`; the cited review landed in T3 at 18:49:03.623Z and the agent
  replied at 18:49:10.929Z (**7.3 s** later) with the revised plan. The thread
  is `completed` with 4 messages.
- `demo/recordings/t3-live-thread.json`: JSON export of the thread's
  messages, plans, the cited review and the agent's reply. Only this thread
  was fetched; the T3 token is not in the file.

**Deck disclosure:** on a cold build the real splitter made a 10-point deck
from this plan (2 context claims + 7 steps + 1 open question). For the
recorded live take the thread was pinned to the 7-point fixture deck
(`PINPOINT_DECK_FIXTURE`) so the notes land on the storyboard's points 4
(truncate) and 6 (mutex). The thread, the review send and the 7.3 s reply are
real; the deck order is pinned. The pin is a recording aid only.

**Web UI screenshot:** skipped. T3's web UI redirected to `/pair` and demands a
one-time pairing token; the orchestration session token is rejected. No
screenshot was saved, so no sidebar thread title from another project could
leak. The API export is the visual proof instead.

## Files

```
demo/recordings/
  inbox.mp4            inbox-before clip          inbox.timeline.json          inbox-sheet.png
  auth.mp4             hero plan review           auth.timeline.json           auth-sheet.png
  inbox-after.mp4      inbox with the thread gone inbox-after.timeline.json   inbox-after-sheet.png
  deps.mp4             one-tap question           deps.timeline.json           deps-sheet.png
  inbox-morning.mp4    4 drafts, 1 correction     inbox-morning.timeline.json  inbox-morning-sheet.png
  live-hero.mp4        real T3 thread review      live-hero.timeline.json      live-hero-sheet.png
  t3-live-thread.json  cited review + agent reply
  live-auth-refresh-fix.deck.json   the 7-point pin used for the live take
```

Each `*.timeline.json` lists every input with global `t` and `sceneMs`
timestamps, the notes/transcripts, markers and the ffprobe result, ready for
the ring-gesture overlay.

## Notes for the editor

- Raw frames are in `demo/shots/tmp/<scene>/` (gitignored, scratch); the
  `auth/` folder was reused by the live take and the final demo re-record, so
  the encoded clips and their timelines are the authoritative copies.
- The app briefly shows the "Heard: …" line for p4 in the live take before the
  next swipe; the full review text is in `t3-live-thread.json` and in the T3
  thread.
- One early take recorded the note on p5/p7 because the next swipe beat the
  1.2 s transcript; the 2 s post-mic wait is the fix. Keep it if re-recording.
- Prime Video was using ~700 % CPU during the first attempts and made the
  simulator miss inputs. It was paused with SIGSTOP for the clean take and
  resumed with SIGCONT afterwards. No other app was changed.
