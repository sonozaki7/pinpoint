# Pinpoint demo — narration (v2)

The voice track for the 2:20 cut. **29 short lines, ~68 s spoken across 140 s**
(about 48% of the film, measured after generation), so the pictures and the room
still have time to breathe.

**Voice:** Kokoro `af_heart` (Apache-2.0 model, `kokoro-onnx`, 24 kHz, speed 1.0),
synthesized locally on this Mac. It replaces the macOS `say` draft. The author’s
own recording is still the better voice; the cut is built so it can be swapped
without touching a scene. If Kokoro is not installed, the builder falls back to
macOS `say` with `Samantha` at 170 wpm.

All on-screen counts are the measured live run: **1 objection, 1 note, 5 agreed**.
The payoff and the close both show **reviewed in 20 s · 2 notes · agent replied in
7 s**, from `docs/recording-log.md`.

## Files

| What | Where |
|---|---|
| Human-readable script (this file) | `docs/narration.md` |
| Machine-readable lines and start times | `demo/film/src/pinpoint/narration.json` |
| Burned-in caption cues (generated) | `demo/film/src/pinpoint/captions.generated.json` |
| Voice track | `demo/film/public/audio/pinpoint-voice-kokoro.mp3` |
| Quiet ambient bed | `demo/film/public/audio/pinpoint-bed-v2.mp3` |
| Which audio the film plays | `audio` in `demo/film/src/clips.json` |
| Vertical teaser lines | `demo/film/src/pinpoint/teaser-narration.json` |
| Vertical teaser voice | `demo/film/public/audio/teaser-voice-kokoro.mp3` |

## Lines

| ID | Time | Line | Scene |
|---|---|---|---|
| `hook-1` | 0:01.2 – 0:04.1 | Your agents write essays. You’re on a train. | Hook — the wall |
| `hook-2` | 0:05.6 – 0:08.2 | Seven lines. Each one a decision. | Hook — the wall |
| `gap-1` | 0:12.8 – 0:16.5 | On glasses today, you can approve, or say one sentence. | Problem — the yes/no card |
| `gap-2` | 0:18.2 – 0:20.9 | A yes or no doesn’t steer an agent. | Problem — the yes/no card |
| `alert-1` | 0:23.6 – 0:26.4 | When a thread needs you, it finds your phone. | Alert — phone → glasses |
| `alert-2` | 0:26.9 – 0:28.6 | Your glasses mirror it. | Alert — phone → glasses |
| `hero-1` | 0:32.8 – 0:35.4 | One thread. A seven-step plan. | Hero — live review |
| `hero-2` | 0:35.6 – 0:38.3 | Every point is one line from the plan. | Hero — live review |
| `hero-3` | 0:39.2 – 0:41.4 | Step four signs everyone out. | Hero — live review |
| `hero-4` | 0:42.6 – 0:44.9 | Your objection lands on that step. | Hero — live review |
| `hero-5` | 0:46.0 – 0:48.6 | Step six: a mutex that deadlocks. | Hero — live review |
| `hero-6` | 0:50.4 – 0:53.4 | Five points pass. One tap to send. | Hero — live review |
| `hero-7` | 0:54.0 – 0:56.1 | Sent. Back to the train. | Hero — live review |
| `payoff-1` | 0:59.8 – 1:02.5 | It lands in the thread as a cited review. | Payoff — real T3 Code thread |
| `payoff-2` | 1:03.0 – 1:05.6 | Twenty seconds to review. Two notes. | Payoff — real T3 Code thread |
| `payoff-3` | 1:06.8 – 1:09.3 | Seven seconds later, the revision. | Payoff — real T3 Code thread |
| `payoff-4` | 1:10.0 – 1:13.1 | Laptop-quality feedback. From your glasses. | Payoff — real T3 Code thread |
| `question-1` | 1:16.7 – 1:18.8 | Questions come as options. | Question — deps-upgrade |
| `question-2` | 1:19.4 – 1:21.9 | One tap: stay on six for now. | Question — deps-upgrade |
| `inbox-1` | 1:26.7 – 1:29.1 | Four drafts from your inbox agent. | Inbox agent — inbox-morning |
| `inbox-2` | 1:29.8 – 1:31.5 | Three pass in silence. | Inbox agent — inbox-morning |
| `inbox-3` | 1:32.6 – 1:35.8 | One correction: make it Thursday, not Tuesday. | Inbox agent — inbox-morning |
| `inbox-4` | 1:37.6 – 1:39.7 | Cleared in twenty-five seconds. | Inbox agent — inbox-morning |
| `telegram-1` | 1:46.8 – 1:49.7 | The full plan waits in a Telegram topic. | Telegram |
| `telegram-2` | 1:50.3 – 1:53.6 | Every note is a quote-reply on its exact sentence. | Telegram |
| `telegram-3` | 1:54.4 – 1:56.8 | Read on phone, right where you stopped. | Telegram |
| `close-1` | 2:00.8 – 2:03.2 | Ring for where. Voice for what. | Close |
| `close-2` | 2:04.4 – 2:08.9 | Even G2, R1, T3 Code, Telegram. Open source. | Close |
| `close-3` | 2:09.0 – 2:15.2 | Seven steps. Reviewed in twenty seconds. Two notes. The agent replied in seven seconds. | Close — proof |

The exact spoken lengths are measured by the builder; the table’s end times are
the generated caption ends at the current speed. If a line is re-recorded, update
its start/end in `captions.generated.json`.

## Installing Kokoro (one-time)

The model and voices are Apache-2.0. Everything stays on this Mac.

```sh
cd demo/film
python3.11 -m venv .venv
.venv/bin/pip install kokoro-onnx soundfile
mkdir -p .models
# official kokoro-onnx model files (model-files-v1.1)
curl -L -o .models/kokoro-v1.0.onnx \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx
curl -L -o .models/voices-v1.0.bin \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin
```

`.venv/` and `.models/` are git-ignored. The 24 kHz mono lines are written to
`demo/out/audio-build/` and mixed with ffmpeg.

## Replacing the voice

1. Record the lines, ideally at the same lengths. Keep each line inside its
   window (a late line runs into the next).
2. Save the take as `demo/film/public/audio/pinpoint-voice-final.mp3`.
3. In `demo/film/src/clips.json`, set `audio.narration` to
   `audio/pinpoint-voice-final.mp3`. Set `audio.bed` to `null` if the take has its
   own music, or lower `bedVolume` (currently 0.32) to taste.
4. If a line moved, update its start/end in
   `demo/film/src/pinpoint/captions.generated.json`. Those are the only numbers the
   captions use. Do **not** run the draft builder after adding the final file:
   it regenerates the TTS draft and the generated captions.

## Rebuilding

```sh
cd demo/film
node scripts/build-audio.mjs                              # Kokoro → captions + voice + bed
node scripts/build-audio.mjs --tts say --voice Samantha  # macOS fallback
node scripts/build-audio.mjs --script src/pinpoint/teaser-narration.json  # vertical teaser
```

The script writes the mix, measures every line with `ffprobe`, and writes the
caption cues. It does not overwrite anything outside `public/audio/` and the
generated files.

## Timing notes

- The first 12 s are the wall; the first line lands after the wall starts moving.
- The big on-screen line **“Approval isn’t feedback.”** is deliberately spoken as
  “A yes or no doesn’t steer an agent.” so the caption adds a thought instead of
  repeating the title.
- The hero voice is timed to the real markers: point 4 at 0:39.2, the p4
  transcript at 0:42.6, point 6 at 0:46.0, the p6 transcript at 0:48.8, preview
  at 0:50.8, sent at 0:52.4. The clip is not slowed.
- The close speaks the measured proof line for the first time: 20 s review,
  2 notes, 7 s reply. The same numbers are shown in the payoff.
- The close holds the URLs for the last ~4 s with no narration.
