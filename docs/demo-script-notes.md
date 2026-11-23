# Demo recording notes (fixtures, simulator script, video handoff)

What this is: the demo side of Pinpoint. `demo/fixtures/` holds four deterministic
threads so the server can run in `PINPOINT_MODE=demo` without T3 Code, and
`demo/scripts/record-sim.mjs` drives the official Even Hub simulator through the
hero sequence while it captures framebuffer frames. `demo/scripts/frames-to-mp4.sh`
turns those frames into clips for the editor.

Nothing here was recorded against a live simulator in this pass: the glasses app
(SPEC §10) was still being written by another agent, so the scripts were proven
with `--dry-run` and `--mock` (a local fake control plane that speaks the same
HTTP API). Run the real capture once the app boots — the commands are below.

Proof from the mock run is kept in `demo/shots/tmp/proof-mock/`: the planning
timeline and markers, one frame, and the encoded clip (1152×576, 30 fps,
45.8 s). Those frames are wireframes drawn by the script, not footage.

## 1. Fixtures

| File | Attention | Points | What it is |
|---|---|---|---|
| `demo/fixtures/auth-refresh-fix.json` | plan | 7 | 7-step auth plan; step 4 truncates the sessions table (high risk), step 6 wraps `refreshToken()` in a mutex |
| `demo/fixtures/deps-upgrade.json` | question | 6 | "Upgrade to Vite 7 now or stay on 6?" with 3 options, recommended first |
| `demo/fixtures/inbox-morning.json` | report | 6 | inbox-triage report with 4 drafted email replies (one proposes Tuesday 10:00) |
| `demo/fixtures/flaky-e2e.json` | failed | 6 | failed e2e run, diagnosis, two proposed fixes |

Each file is `{ thread, source, deck }`:

- `thread` — `threadId` (= the file name), `title`, `project`, `attention`, `updatedAt`.
- `source` — `sourceMessageId`, `text` (the agent's markdown message), `kind`
  (`plan` | `reply` | `question`), and `question` for the question fixture.
- `deck` — the `Deck` from `shared/contract.ts`: `headline`, `points` (4–10),
  `createdAt`, `splitter: "fixture"`.

Deck rules, enforced by the checker (SPEC §7):
points carry a 1-based `index`, a `glance` of at most 44 plain-ASCII characters,
and a `quote` that is an **exact substring** of `source.text` (at most 200
characters). Question points carry 2–4 `options` of 24 characters or fewer plus
a `questionId` that matches a question in `source.question`. Destructive steps
are `kind: "risk"` with `risk: "high"`.

Check them after any edit:

```
node demo/scripts/verify-fixtures.mjs
```

It prints one line per fixture and exits non-zero on the first bad quote, a
glance over 44 characters, a non-ASCII character, a missing option, a duplicate
`threadId`, or a source text outside 250–700 words. Current result: `OK 4
fixtures, 25 points, 421 checks`.

The inbox order the glasses show (SPEC §5) is question, plan, failed, report —
so row 1 is `deps-upgrade`, row 2 `auth-refresh-fix`, row 3 `flaky-e2e`,
row 4 `inbox-morning`. The recorder's swipe counts depend on that order.

## 2. Recording

Prerequisites, in two terminals:

```
# 1. server in demo mode (fixtures, no T3, no Telegram needed)
cd apps/server && PINPOINT_MODE=demo npm start        # http://127.0.0.1:8787

# 2. glasses app dev server
cd apps/glasses && npm run dev                        # http://127.0.0.1:5173
```

Then the simulator, with its automation API on:

```
node apps/glasses/node_modules/@evenrealities/evenhub-simulator/bin/index.js \
  http://127.0.0.1:5173 --automation-port 9898
```

The recorder can start the simulator itself with `--launch`. If the port already
answers `/api/ping` it reuses that instance instead of launching a second one,
and it only ever stops a simulator it started. Another agent may hold 9898, so
recording into your own port is one flag:

```
node demo/scripts/record-sim.mjs --launch --port 9917
```

Everyday commands:

```
node demo/scripts/record-sim.mjs --list                    # scenes and planned seconds
node demo/scripts/record-sim.mjs --dry-run                 # plan only, writes a planning timeline
node demo/scripts/record-sim.mjs --mock --out demo/shots/tmp/mock   # fake control plane, pipeline test
node demo/scripts/record-sim.mjs --port 9898               # record against a running simulator
node demo/scripts/record-sim.mjs --scenes auth,deps        # record part of the sequence
node demo/scripts/record-sim.mjs --step-ms 900 --voice-ms 3000      # slower, for the edit
```

Options that matter: `--capture-ms` (frame cadence, default 100 = 10 fps),
`--step-ms` (hold after each input, default 700), `--voice-ms` (simulated note
length, default 2600), `--out`, `--scenes`, `--no-capture`, `--strict` (abort on
a failed input instead of warning), `--ready-pattern` (regex for the app's
"ready" log line, default `pinpoint|ready`).

The simulator has no headless mode (0.9.5), so a window opens on screen. Input
sent before the app creates its first event-capturing container is dropped
silently, which is why the script waits for a ready log line before the first
tap — the glasses app logs `[pinpoint] ready`, which the default pattern
(`pinpoint|ready`) already matches. Record after the glasses app builds and
serves a working inbox; a half-built app records the wrong screens.

## 3. The sequence and its timings

Default pacing, from `--list`:

| Scene | Seconds | Inputs | Content |
|---|---|---|---|
| `inbox` | 2.7 | 1 | inbox list, focus lands on `auth-refresh-fix` |
| `auth` | 20.0 | 14 | open the plan, swipe to step 4, note 1, step 6, note 2, Send row, preview, send |
| `deps` | 8.3 | 4 | open the question, one tap on the options, pick `Stay on 6 for now`, back |
| `inbox-morning` | 14.9 | 13 | open the report, pass 3 drafts, correct the Tuesday draft, back |
| total | 45.9 | 32 | |

Inside `auth`: three swipes to step 4 → tap, 2.6 s of "speech", tap to stop →
two swipes to step 6 → tap, 2.6 s, tap → two swipes to the Send row → tap →
preview (1.6 s) → tap → send (2.6 s, covers the 1.5 s "Sent to agent" toast).
The two note transcripts are what demo mode returns for those recordings:

- step 4 (objection): "No, don't log everyone out. Migrate existing sessions."
- step 6 (note): "Use a request queue, a mutex deadlocks with the retry path."

`inbox-morning` records these as the correction: "Thursday, not Tuesday."

If the app's keys differ (a different row count, options that need a swipe
first, a hold menu instead of a double-tap), edit the scene tables at the top of
`demo/scripts/record-sim.mjs` — they are plain lists of `{ action, label, hold }`
and `{ note }` steps, nothing else needs to change.

## 4. Output layout

```
demo/shots/tmp/
  timeline.json          every event: scene, type, action, label, ms, frame index
  markers.json           editor cut points per scene (sceneMs + frame)
  <scene>/
    00001.png ...        RGBA framebuffer frames, 576x288, green text on transparent
    meta.json            frame count, durationMs, measured fps
  out/                   frames-to-mp4.sh output
```

Frames are captured at roughly 10 fps; `meta.json` records the measured rate so
the encoder plays them back at true speed even if the machine dropped a frame
(e.g. `9.91` instead of exactly `10`). A warning line `framebuffer did not
advance after this input` means a tap went nowhere — usually a wrong focused row
or a dropped input, and that scene should be re-recorded.

## 5. Encoding

```
demo/scripts/frames-to-mp4.sh --root demo/shots/tmp --all            # every scene + hero.mp4
demo/scripts/frames-to-mp4.sh --root demo/shots/tmp --scene auth     # one clip
demo/scripts/frames-to-mp4.sh --root demo/shots/tmp --all --crf 16 --audio narration.wav
```

Each frame is composited on a black 576×288 canvas, scaled 2× with
nearest-neighbour (1152×576, crisp pixel edges, no blur), and laid onto a 30 fps
timeline; output is h264 `yuv420p` with `faststart`. `--all` also concatenates
the scenes in `--order` (default `inbox,auth,deps,inbox-morning`) into
`hero.mp4`; `--audio` muxes a narration track over it. Verified output of the
mock run: 1152×576, 30/1 fps, 45.8 s.

## 6. What the video editor needs

- Raw footage is 1152×576 after scaling, 30 fps, 45.9 s total. The storyboard's
  hero block is 60 s (0:35–1:35), so either hold frames on the marked beats or
  re-record with `--step-ms 900` for a longer, calmer take.
- `markers.json` is the cut list. Marker labels map to beats: `inbox:first-frame`,
  `auth:deck`, `auth:point4`, `auth:point4-objected`, `auth:point6`,
  `auth:point6-noted`, `auth:send-row`, `auth:preview`, `auth:sent`,
  `deps:question`, `deps:options`, `deps:answered`, `morning:deck`,
  `morning:tomas-draft`, `morning:corrected`, `morning:send-row`.
  Each marker has `sceneMs` (from that scene's first frame) and `frame` (the PNG
  number), so a cut can be placed by frame number without guessing.
- `timeline.json` has the same beats plus every input and the two transcripts,
  useful for caption timing: the "speaking" window is a `wait` event of
  `voiceMs` right after the `tap to record` input.
- Burned-in captions should follow `docs/DEMO.md`; scene text lines for the
  proof line (`7-step plan · reviewed in 38 s · 2 precise corrections · 0 laptops`)
  come from the real run's timeline, not from this document.
- The glasses frame is green-on-black with no lens bezel; `demo/film/` already
  has the G2 lens framing, so the clip can be dropped in as is.
- Mock frames in `demo/shots/tmp/mock/` are wireframe placeholders drawn by the
  script. Delete them (`rm -rf demo/shots/tmp/mock`) before the edit so they are
  never mistaken for footage.
- `demo/shots/tmp/` is git-ignored: frames never go into the repo, only the
  scripts and this note do.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no simulator automation API on 127.0.0.1:9898` | no simulator, or it was started without `--automation-port` | restart it with `--automation-port 9898`, or use `--launch --port 9917` |
| taps do nothing on the first scene | input sent before the app's first event container | raise `--ready-ms`, or set `--ready-pattern` to the app's own ready log line |
| the wrong thread opens | inbox order differs from SPEC §5 | fix the fixture attention values or adjust the swipe counts in the scene table |
| note text does not appear | the tap that starts recording missed the point | re-record that scene; check the console for the `textEvent` |
| video drifts from audio | frames dropped during capture | encode again: `meta.json` carries the measured fps, the script reads it |
