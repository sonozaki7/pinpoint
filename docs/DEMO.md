> **OUTDATED (Nov 27 2026): this is the v1 storyboard (T3-only story, "Ring for where. Voice for what.").** The current film is built from `demo/film/` and tells the attention-layer story: [../README.md](../README.md). The proof numbers below (20 s review, agent replied in 7 s) are from the Nov 24 live run and are still true for that run ([recording-log.md](recording-log.md)). Submission copy: [SUBMISSION.md](SUBMISSION.md).

# Pinpoint — demo video and pitch (v1)

Goal: in 2:30–2:50, a judge who has watched 40 "approve from your glasses" demos understands in the first 15 seconds why this one is different, and sees **real** proof (real simulator, real T3 Code thread, real Telegram), not a mock.

## Positioning (use these exact lines)

- Tagline: **Ring for where. Voice for what.**
- One-liner: *Review your AI agents' work from Even G2 — point by point, with the precision of your laptop.*
- Contrast line: *Everyone built "approve from your glasses". Approval isn't feedback.*
- Principle: *Silence means agree. You only speak when something's wrong.*
- Proof line at the end: real numbers from the recorded run, e.g. `7-step plan · reviewed in 20 s · 2 precise corrections · agent replied in 7 s` (measured in the live run, docs/recording-log.md).

## Storyboard (target 2:40, captions burned in — judges often watch muted)

| Time | Scene | On screen | Proof source |
|---|---|---|---|
| 0:00–0:12 | Hook | A 900-word agent plan scrolls like a wall on a laptop. It collapses into 7 green one-line points inside a G2 frame. Caption: "Your agents write essays. You're on a train." | Remotion + real deck from the splitter |
| 0:12–0:25 | Problem | A generic Yes/No card (no brand). Caption: "On glasses today you can approve, or say one sentence. That's not feedback." | Remotion |
| 0:25–0:35 | Alert | Phone notification "Pinpoint Desk · auth-refresh-fix needs you · plan, 7 steps" mirrored on the glasses. | Real Telegram message (screenshot) |
| 0:35–1:35 | Hero: plan review | Simulator footage in the G2 frame. Ring overlay icons for each gesture (swipe / tap / talk). Step 4 flagged `!` → tap → speak "No — don't log everyone out. Migrate existing sessions." → transcript appears, marker `x`. Step 6 → "Use a request queue; a mutex deadlocks with the retry path." Other steps pass in silence → counter `+5 agreed`. Send row → preview → Sent. | Real simulator recording (automation script) |
| 1:35–1:50 | The payoff | Cut to the real T3 Code window: the cited review lands in the thread, the agent answers "Revised plan: migrate sessions, request queue instead of mutex" and keeps working. Caption: "Laptop-quality feedback. From your glasses." | Real T3 thread (screen capture) |
| 1:50–2:05 | Question | `deps-upgrade`: options on the glasses, one tap "Stay on 6 for now". Caption: "Agent questions: one tap." | Simulator |
| 2:05–2:25 | Inbox agent (Track 4) | `inbox-morning`: 4 drafted email replies; 3 agreed in silence; one correction "Thursday, not Tuesday". Caption: "Your inbox agent, cleared in 25 seconds." | Simulator |
| 2:25–2:40 | Telegram | Phone: Pinpoint Desk topics, the full reply with your notes as quote-replies on the exact sentences; "Read on phone" lands on step 4. | Real Telegram (screenshots/recording) |
| 2:40–2:50 | Close | "Ring for where. Voice for what." · "Even G2 + R1 · T3 Code · Telegram · open source" · URL + GitHub. | Remotion |

## Production pipeline

1. **Simulator footage:** `demo/scripts/record-sim.mjs` drives the official simulator through `POST /api/input` and grabs `GET /api/screenshot/glasses` frames at a fixed cadence (glasses UI is discrete, ~10 fps is enough), composited green-on-black into a G2 lens frame. Deterministic: `PINPOINT_MODE=demo`, fixture decks, scripted transcripts for timing (live voice is proven separately for A4 and shown in one short clip).
2. **Real proof clips:** T3 Code window and Telegram (desktop or phone) screenshots/recordings, captured after the live run (morning, when the bot exists).
3. **Edit:** Remotion project in `demo/film/` (imported from Agent Relay; reuse its fonts, captions, and lens framing). Output `demo/out/pinpoint-demo.mp4` 1920×1080 h264, plus a 9:16 cut for social.
4. **Narration:** short sentences matching the captions. Default: the user records it (better). Fallback: a TTS draft so the cut can be timed tonight.

## Also needed for submission

- DoraHacks description (problem, who it's for, how it works, tracks) — `docs/SUBMISSION.md`.
- Up to 5 API feature requests (collect them as we hit real gaps) — `docs/FEATURE_REQUESTS.md`.
- Thumbnail (frame from the hook scene).
