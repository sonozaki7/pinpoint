# Pinpoint demo — narration (draft)

The draft voice track for the 2:45 cut. Thirty short lines, **66.8 s spoken** across
165 s (about 40% of the film), so the pictures and the room have time to breathe.
The burned-in captions are generated from this same text.

**Voice:** macOS `say`, `Samantha` (en_US), 170 wpm, synthesized locally. It is a
timing draft, not the final performance. The author’s own recording is the better
voice; the cut is built so it can be swapped without touching a scene.

## Files

| What | Where |
|---|---|
| Human-readable script (this file) | `docs/narration.md` |
| Machine-readable lines and start times | `demo/film/src/pinpoint/narration.json` |
| Burned-in caption cues (generated) | `demo/film/src/pinpoint/captions.generated.json` |
| Draft voice track | `demo/film/public/audio/pinpoint-voice-draft.mp3` |
| Quiet ambient bed | `demo/film/public/audio/pinpoint-bed-draft.mp3` |
| Which audio the film plays | `audio` in `demo/film/src/clips.json` |

## Lines

| ID | Time | Line | Scene |
|---|---|---|---|
| `hook-1` | 0:01.2 – 0:04.3 | Your agents write essays. You’re on a train. | Hook — the wall |
| `hook-2` | 0:05.6 – 0:08.3 | Seven lines. Each one a decision. | Hook — the wall |
| `gap-1` | 0:13.0 – 0:17.2 | On glasses today, you can approve, or say one sentence. | Problem — the yes/no card |
| `gap-2` | 0:19.4 – 0:21.8 | A yes or no doesn’t steer an agent. | Problem — the yes/no card |
| `alert-1` | 0:24.6 – 0:27.5 | When a thread needs you, it finds your phone. | Alert — phone → glasses |
| `alert-2` | 0:28.4 – 0:30.1 | Your glasses mirror it. | Alert — phone → glasses |
| `hero-1` | 0:33.4 – 0:36.0 | One thread. A seven-step plan. | Hero — plan review |
| `hero-2` | 0:37.2 – 0:40.9 | Every point is one line, tied to the plan’s own words. | Hero — plan review |
| `hero-3` | 0:44.4 – 0:46.7 | Step four would sign everyone out. | Hero — plan review |
| `hero-4` | 0:49.8 – 0:51.4 | Tap. Talk. | Hero — plan review |
| `hero-5` | 0:55.2 – 0:57.9 | Your objection lands on that exact step. | Hero — plan review |
| `hero-6` | 1:03.4 – 1:07.4 | Step six: a mutex that deadlocks with the retry path. | Hero — plan review |
| `hero-7` | 1:08.4 – 1:10.4 | The rest pass in silence. | Hero — plan review |
| `hero-8` | 1:11.6 – 1:13.9 | Preview. One tap to send. | Hero — plan review |
| `hero-9` | 1:18.6 – 1:20.1 | Sent to the agent. | Hero — plan review |
| `hero-10` | 1:26.2 – 1:27.6 | Back to the train. | Hero — plan review |
| `payoff-1` | 1:33.8 – 1:36.3 | It lands in the thread as a cited review. | Payoff — T3 Code |
| `payoff-2` | 1:39.2 – 1:42.1 | The agent revises the plan and keeps working. | Payoff — T3 Code |
| `payoff-3` | 1:43.4 – 1:46.6 | Laptop-quality feedback. From your glasses. | Payoff — T3 Code |
| `question-1` | 1:47.8 – 1:49.8 | Questions come as options. | Question — deps-upgrade |
| `question-2` | 1:51.2 – 1:53.9 | One tap: stay on six for now. | Question — deps-upgrade |
| `inbox-1` | 2:00.6 – 2:03.0 | Four drafts from your inbox agent. | Inbox agent — inbox-morning |
| `inbox-2` | 2:04.2 – 2:06.1 | Three pass in silence. | Inbox agent — inbox-morning |
| `inbox-3` | 2:07.4 – 2:10.6 | One correction: Thursday, not Tuesday. | Inbox agent — inbox-morning |
| `inbox-4` | 2:11.8 – 2:13.9 | Cleared in twenty-five seconds. | Inbox agent — inbox-morning |
| `telegram-1` | 2:18.6 – 2:21.4 | The full plan waits in a Telegram topic. | Telegram |
| `telegram-2` | 2:22.8 – 2:26.1 | Every note is a quote-reply on its exact sentence. | Telegram |
| `telegram-3` | 2:27.4 – 2:30.1 | Read on phone, right where you stopped. | Telegram |
| `close-1` | 2:32.8 – 2:35.2 | Ring for where. Voice for what. | Close |
| `close-2` | 2:36.8 – 2:42.1 | Even G2, R1, T3 Code, Telegram. Open source. | Close |

## Replacing the voice

1. Record the lines, ideally at the same lengths. Keep each line inside its window
   (a late line will run into the next).
2. Save the take as `demo/film/public/audio/pinpoint-voice-final.mp3`.
3. In `demo/film/src/clips.json`, set `audio.narration` to
   `audio/pinpoint-voice-final.mp3`. Set `audio.bed` to `null` if the take has its
   own music, or lower `bedVolume` (currently 0.5) to taste.
4. If a line moved, update its start/end in
   `demo/film/src/pinpoint/captions.generated.json`. Those are the only numbers the
   captions use. Do **not** run the draft builder after adding the final file:
   it regenerates the TTS draft and the generated captions. If you want the
   builder to re-time the cut first, keep the final file under a different name.

## Rebuilding the draft

```sh
cd demo/film
node scripts/build-audio.mjs          # say → captions.generated.json → voice + bed
```

The script writes the mix, measures every line with `ffprobe`, and writes the
caption cues. It does not overwrite anything outside `public/audio/` and the two
generated files.

## Timing notes

- The first 12 s are the wall; the first line lands after the wall starts moving.
- The big on-screen line **“Approval isn’t feedback.”** is deliberately spoken as
  “A yes or no doesn’t steer an agent.” so the caption adds a thought instead of
  repeating the title.
- The close holds the URLs for the last ~5 s with no narration.
- The proof line from `docs/DEMO.md` is **not** spoken in this draft, because the
  real recorded run’s numbers are not in yet. Add it at the close once they are.
