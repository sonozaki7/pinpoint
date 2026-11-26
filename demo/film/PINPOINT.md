# Pinpoint demo film — v2

The 2:20 cut for the Pinpoint hackathon submission. 1920×1080, 30 fps, burned-in
captions, Kokoro voice, real simulator footage. Composition `PinpointDemo` in
`src/index.tsx`; the vertical teaser is `PinpointTeaser` (1080×1920, 41 s).

It reuses the Agent Relay film’s fonts (Inter, IBM Plex Mono), paper and ink,
caption pill, and accent jade — but the stage is a G2 lens, not a photo plate.

## Scenes (140 s)

| Time | Scene | On screen | Source |
|---|---|---|---|
| 0:00–0:12 | Hook | The real 510-word plan as a scrolling wall, collapsing into 7 real glances | Real fixture text + designed motion |
| 0:12–0:23 | Problem | Generic “Apply the plan?” Yes/No card, then “Approval isn’t feedback.” | Illustration |
| 0:23–0:32 | Alert | Lock-screen notification (illustrative phone) mirrored into the real glasses inbox | Real `clips/inbox.mp4` + designed phone |
| 0:32–0:59 | Hero | Real `live-hero.mp4` (0–22.0 s): inbox → points 1–3 → point 4 objection → point 6 note → preview → sent, then the cleared inbox (`inbox-after.mp4`) | Real live recording + real cleared inbox |
| 0:59–1:16 | Payoff | The real cited review and the agent’s real reply, in T3 Code | `t3-live-thread.json` export |
| 1:16–1:26 | Question | `deps-upgrade` options → one tap → “Stay on 6 for now” | Real `clips/deps.mp4` |
| 1:26–1:46 | Inbox agent | Four drafts, one correction, three agreed; board beside the real lens | Real `clips/inbox-morning.mp4` |
| 1:46–2:00 | Telegram | Pinpoint Desk topic with quote-replies | Placeholder (TODO-real) |
| 2:00–2:20 | Close | “Ring for where. Voice for what.” + measured proof + site/GitHub | Designed |

The live run’s counts appear everywhere as **1 objection, 1 note, 5 agreed**. The
payoff and close show **Reviewed in 20 s · 2 notes · agent replied in 7 s** from
`docs/recording-log.md`; the close also speaks that line.

## Real footage and clips.json

Everything visual is wired through **`src/clips.json`**. A scene renders one of
four sources:

- `{"kind": "design"}` — built in Remotion (hook, problem, close, and the
  placeholder Telegram board).
- `{"kind": "stills", ...}` — each scene has a `stills` map; the scene’s beat
  table picks the file. These are now fallbacks, not the delivered path.
- `{"kind": "clip", "src": "clips/live-hero.mp4", "delay": 1.1}` — an mp4 inside
  the lens. `delay` starts it later than the scene; `startAt` trims its head.
- `{"kind": "frames", "dir": "clips/auth", "fps": 9.91, "count": 182}` — a frame
  folder from `demo/scripts/record-sim.mjs`.

The v2 sources are the real recordings copied from `demo/recordings/`:

| Scene | File | Duration |
|---|---|---|
| Alert glasses | `clips/inbox.mp4` | 2.667 s |
| Hero | `clips/live-hero.mp4` | 22.8 s |
| Hero cleared inbox | `clips/inbox-after.mp4` | 1.933 s |
| Question | `clips/deps.mp4` | 8.167 s |
| Inbox agent | `clips/inbox-morning.mp4` | 16.1 s |

`demo/recordings/` is git-ignored scratch, so the film keeps its own copy under
`public/clips/`. Re-sync after a new recording:

```sh
cd demo/film
node scripts/sync-recordings.mjs
```

That script copies the five mp4s, copies the T3 proof export to
`src/pinpoint/fixtures/t3-live-thread.json`, and **regenerates every `inputs`
array from the matching `*.timeline.json`**. The ring-gesture chips are therefore
exact: swipe/tap/talk appear at the recording’s own input timestamps, not on a
hand-written schedule. Do not add an input the recording does not contain.

Scene boundaries live in `src/pinpoint/timeline.ts` (140 s). The hero is 27 s:
the real live run to the sent toast (22.0 s of the 22.8 s clip) plus the 1.9 s
cleared-inbox cut, with a short hold. The question is 10 s (8.2 s clip), the
inbox 20 s (16.1 s clip).

## Payoff: the real thread

`demo/recordings/t3-live-thread.json` is the export of
`mcp:0cc3681c-17ba-4d06-8a88-d9218fcd4d4e` (“auth-refresh-fix”, project
“pinpoint”). The scene reads it through `src/pinpoint/t3.ts`:

- the review is shown line-for-line from `review.text`;
- the reply is shown from `reply.text`, cut only at paragraph boundaries and
  ended with `…` — never reworded;
- the plan title, 18:49:03 UTC / 18:49:10 UTC timestamps, project, provider
  (`opencode`) and `completed` status are the real ones;
- the label is **Real thread · exported from T3 Code**, not “illustration”.

If the export changes, re-run `sync-recordings.mjs`; the excerpt markers throw at
render time if a cut no longer matches the text.

## Audio

The film plays `audio.narration` and `audio.bed` from `clips.json`. The v2 voice
is **Kokoro `af_heart`** (Apache-2.0, `kokoro-onnx`, 24 kHz, speed 1.0), generated
locally with `scripts/build-audio.mjs`; the bed is a quiet synthesized drone at
`bedVolume: 0.32`. The macOS `say` fallback remains (`--tts say --voice Samantha`).
See `docs/narration.md` for the lines, timings, install steps, and how to swap in
the author’s own recording. The swap point is still one line in `clips.json`.

The Kokoro voice, bed and teaser voice are git-ignored (like the old draft) and
can be regenerated with `npm run voice` plus the teaser command in
`docs/narration.md`. The model and `.venv` are local only.

## Vertical teaser

`PinpointTeaser` is a 41 s 1080×1920 cut: hook → the real hero footage (p4 and p6
notes, sent) → the real review/reply → close. It uses the real clips at native
speed and the same Kokoro voice; the teaser lines are in
`src/pinpoint/teaser-narration.json`.

## Render

Remotion’s own headless-Chrome download is blocked/slow on this Mac, so the scripts
pass the installed Google Chrome explicitly. The flag is in `package.json`; add it
by hand if you run the CLI directly.

```sh
cd demo/film
npm run check                  # tsc, must stay green
npm run render:pinpoint        # → demo/out/pinpoint-demo-v2.mp4, h264 crf 20, AAC
npm run poster                 # → demo/out/poster-v2.png, 1920×1080
npm run render:teaser          # → demo/out/pinpoint-teaser-9x16.mp4
npm run sheet                  # → demo/out/v2-sheet.png, 4×4 contact sheet
```

Equivalent direct command:

```sh
npx remotion render src/index.tsx PinpointDemo ../out/pinpoint-demo-v2.mp4 \
  --codec=h264 --crf=20 --pixel-format=yuv420p --concurrency=6 \
  --browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

`demo/out/` is git-ignored. The raw simulator frames stay in `demo/shots/tmp/`
(also ignored); only `demo/shots/glasses-*.png` are copied into `public/shots/`
for fallbacks.

The contact sheet is a QA gate, not decoration: check it for cut-off text,
mismatched counters, black frames and wrong scene order before submitting.

## Real vs placeholder

**Real:** the simulator clips (live-hero, deps, inbox, inbox-after,
inbox-morning), their timelines and gesture overlays; the T3 thread export (cited
review + agent reply, timestamps, provider, status); the measured numbers; the
plan fixture text; the Kokoro voice.

**Still placeholder (labelled, and listed under `todoReal` in `clips.json`):**

1. **Alert phone** — the lock-screen notification is built in Remotion; no real
   phone push capture exists.
2. **Telegram topic** — the Pinpoint Desk topic and quote-replies are an
   illustration until the real bot exists and is recorded.

The author’s own voice can replace Kokoro without touching a scene. The hero
deck order is still the pinned 7-point fixture (`live-auth-refresh-fix.deck.json`);
the thread, review send and 7 s reply are real (see `docs/recording-log.md`).

## v3 · PinpointSimple (plain-language cut)

The judge-facing v3 cut is a second composition, `PinpointSimple`, at
1920×1080 / 30 fps / 103 s. `PinpointDemo` is untouched and still renders.

```sh
cd demo/film
npm run audio:simple       # Kokoro af_heart + am_michael phone-EQ note → public/audio/simple-voice.wav
npm run render:simple      # → demo/out/pinpoint-demo-v3.mp4
npm run poster:simple      # → demo/out/poster-v3.png
npm run sheet:simple       # → demo/out/v3-sheet.png, 5×7, one frame every 3 s
```

New footage for this cut comes from `demo/scripts/record-sim.mjs` scenes
`simple-plan`, `simple-payment`, `simple-inbox` (see `demo/recordings/` and
`demo/film/public/clips/{plan-review,payment-question,inbox-fix}.mp4`). The
clips were recorded from the frozen checkout `ebc1251` with the sample
workspace pinned to `login-fix`, `payment-upgrade`, `inbox-morning`; the
recording aids live in that checkout, not in the product.

The full scene list, exact narration, and the real-vs-designed breakdown are in
`demo/out/v3-scenes.md`. Credits and licenses are in `CREDITS.md`.

The Telegram phone in scene 7 is a designed reconstruction, not a screenshot:
the available capture shows the earlier technical plan, which v3 must not show.
It is labelled “Telegram · sample workspace” on screen.

Delivery note: Remotion's H.264 output is full-range (`yuvj420p` on this
machine). The submitted file was re-encoded once to limited-range `yuv420p`
(CRF 18) and its audio remuxed from the normalized mix, so players and editors
agree on colour; loudness stayed at −16.0 LUFS and true peak −1.6 dBFS.
