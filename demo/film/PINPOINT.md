# Pinpoint demo film

The 2:45 draft for the Pinpoint hackathon submission. 1920×1080, 30 fps, burned-in
captions, draft voice. Composition `PinpointDemo` in `src/index.tsx`.

It reuses the Agent Relay film’s fonts (Inter, IBM Plex Mono), paper and ink,
caption pill, and accent jade — but the stage is a G2 lens, not a photo plate.

## Scenes

| Time | Scene | On screen | Source in this draft |
|---|---|---|---|
| 0:00–0:12 | Hook | The real 511-word plan as a scrolling wall, collapsing into the 7 real glances in the lens | Real fixture text + designed motion |
| 0:12–0:24 | Problem | Generic “Apply the plan?” Yes/No card, then “Approval isn’t feedback.” | Illustration |
| 0:24–0:33 | Alert | Lock-screen notification mirrored into the glasses inbox | Designed phone + real simulator still |
| 0:33–1:33 | Hero | Inbox → point 1 → point 4 → record → transcript → step 6 note → preview → sent → inbox | Real simulator stills |
| 1:33–1:47 | Payoff | The cited review lands in a T3 Code thread; the agent revises the plan | Placeholder T3 UI |
| 1:47–2:00 | Question | deps-upgrade options → one tap → “Stay on 6 for now” | Real simulator stills |
| 2:00–2:18 | Inbox agent | Four drafts, three pass, one correction | Placeholder board from the real fixture |
| 2:18–2:32 | Telegram | Pinpoint Desk topic with quote-replies | Placeholder Telegram UI |
| 2:32–2:45 | Close | “Ring for where. Voice for what.”, stack line, site + GitHub | Designed |

The exact status labels also live in `src/clips.json` (`status` per scene).

## Swapping in real captures

Everything visual is wired through **`src/clips.json`**. A scene renders one of four
sources:

- `{"kind": "design"}` — built in Remotion (hook, problem, close, and the
  placeholder T3/Telegram/inbox boards).
- `{"kind": "stills", ...}` — actually each scene has a `stills` map; the scene’s
  beat table picks the file. Change a path here to reorder or replace a still.
- `{"kind": "clip", "src": "clips/auth.mp4", "startAt": 0}` — an mp4 inside the
  lens. Copy it under `public/clips/`.
- `{"kind": "frames", "dir": "clips/auth", "fps": 9.91, "count": 182}` — a frame
  folder from `demo/scripts/record-sim.mjs`. Optional `meta` or `timeline` +
  `sceneId` make it read `meta.json` / `timeline.json` instead of the numbers.
  Copy the folder under `public/clips/`.

Examples:

```json
"alert": { "source": { "kind": "clip", "src": "clips/inbox.mp4" } }
"hero":  { "source": { "kind": "frames", "dir": "clips/auth",
                       "timeline": "clips/timeline.json", "sceneId": "auth" } }
```

Set `"source": null` to return to the stills. For the hero and question scenes,
keep the `inputs` array in sync with the new recording; `at` is seconds from the
scene’s first frame and drives the ring-gesture chip. The scene boundaries live in
`src/pinpoint/timeline.ts` (165 s). If a real recording is a different length,
change the scene’s start/end there and re-time the caption cues.

Copy new simulator stills into the film and refresh the fixture copies:

```sh
cd demo/film
node scripts/sync-shots.mjs
```

## Audio

The film plays `audio.narration` and `audio.bed` from `clips.json`. The draft voice
is macOS `say` (Samantha, 170 wpm); the bed is a quiet synthesized drone. Both are
drafts. See `docs/narration.md` for the lines, timings, and how to swap the voice.

```sh
node scripts/build-audio.mjs    # regenerate the draft voice + captions
```

If the final recording moves a line, update the start/end in
`src/pinpoint/captions.generated.json`; captions and audio are independent.

## Render

Remotion’s own headless-Chrome download is blocked/slow on this Mac, so the scripts
pass the installed Google Chrome explicitly. The flag is in `package.json`; add it
by hand if you run the CLI directly.

```sh
cd demo/film
npm run check                  # tsc, must stay green
npm run render:pinpoint        # → demo/out/pinpoint-demo-draft.mp4, h264, crf 20
npm run poster                 # → demo/out/poster.png, 1280×720, frame 1425
```

Equivalent direct command:

```sh
npx remotion render src/index.tsx PinpointDemo ../out/pinpoint-demo-draft.mp4 \
  --codec=h264 --crf=20 --pixel-format=yuv420p --concurrency=4 \
  --browser-executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

`demo/out/` is git-ignored. The raw simulator frames stay in `demo/shots/tmp/`
(also ignored); only `demo/shots/glasses-*.png` are copied into
`public/shots/` for the film.

The delivered cut has one post-fix: a three-frame Chrome compositor artifact at
50.0 s was replaced from the next clean frame. The stills are now keyed per beat
in the source so a re-render remounts the image instead of swapping its `src`,
which is the likely cause.

## Still to replace before submission

1. **Hero**: the current stills show one objection (the captured run had one
   note). The storyboard wants two; a fresh capture with both notes will make the
   send-row counter and this cut agree.
2. **Payoff**: the T3 Code window is an illustration, labelled as such on screen.
3. **Telegram**: the topic and quote-replies are an illustration, labelled.
4. **Inbox agent**: no `inbox-morning` capture exists yet; the board uses the
   fixture’s real glances and is labelled illustrative.
5. **Voice**: replace the TTS draft with the author’s recording.
6. **Proof line**: add the real run’s numbers to the close once recorded.
