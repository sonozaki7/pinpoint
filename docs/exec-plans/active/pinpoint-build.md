# Goal: Pinpoint submission-ready for Heads Up (deadline Mon Nov 30 04:59 JST)

Status: active · Delivery boundary: public GitHub repo + live site + demo video + DoraHacks submission (submission itself needs the user)
Spec: `docs/SPEC.md` · Demo/pitch: `docs/DEMO.md` · Acceptance rows: SPEC §13 (A1–A8)

## Run card

- Objective: build Pinpoint end to end (glasses app, server, T3 live mode, Telegram, site, video) per SPEC.
- Cost rule (user, 2026-11-24): all coding/testing/research by DeepSeek V4.1 Flash delegates (OpenCode Go). Opus only plans, reviews summaries, commits, decides.
- Current path: Wave 1 delegates running (see board).
- Next three actions: integrate wave 1 → wave 2 (site deploy, demo recording, live T3 run) → polish + README.
- Open blockers (need the user, deferred to morning): Telegram bot token + group, flip repo public, DNS for site (if needed), narration voice.
- Last checkpoint: 2026-11-24 ~01:50 JST, repo scaffolded.

## Task board

| ID | Task | Owner (delegate) | Status | Result |
|---|---|---|---|---|
| W1 | Glasses app per SPEC §10, simulator screenshots | DeepSeek | done | 13 sim screenshots, .ehpk 47 KB, tests green |
| W2 | Server core | DeepSeek | done | 125 tests; T3 voice 189 ms; opencode split 20 s, 8/8 quotes valid |
| W3 | T3 client + `docs/t3-api-notes.md` | DeepSeek | done | live: report/plan/question verified on T3 0.1.11; 3 sandbox threads to clean up later |
| W4 | Telegram module | DeepSeek | done | 32 tests, dry-run flow; needs real bot to verify |
| W5 | Hosting recon | DeepSeek | done | GitHub Pages in sonozaki7/pinpoint once public |
| W6 | Demo fixtures + sim recorder | DeepSeek | done | 4 fixtures, 25 points verified |
| W7 | Landing site | DeepSeek | done | apps/site; hero stats are placeholders → replace with real run numbers |
| W8 | Video pipeline + draft render (Remotion) | DeepSeek | done | 2:45 draft; W8b = v2 with real footage + Kokoro voice (running) |
| W9a | Server live mode vs T3 (project allowlist) | DeepSeek | done | privacy gate; report/question/plan live-verified |
| W10 | README, SUBMISSION.md, FEATURE_REQUESTS.md | DeepSeek | done (draft) | final pass after video/live numbers |
| W11 | Glasses polish + run against real server | DeepSeek | done | focus cursor, counters; real mic via T3 179 ms |
| W12 | Scene recordings + live proof run | DeepSeek | done | open→send 20.4 s, 2 notes, agent replied 7.3 s; T3 screenshot needs pairing (morning) |
| W13 | Final docs pass, real numbers, cleanup sandbox threads, make public (user OK) | — | queued (after W8b + morning items) | |
| W14 | Hardening + `npm run demo` + `npm run check` | DeepSeek | done | 155 server + 19 glasses tests |

## Morning checklist for the user (big or account-bound decisions)

1. Create the Telegram bot (@BotFather) and a private group with Topics; add the bot as admin (5 minutes, guided).
2. Approve making the GitHub repo public (needed for submission).
3. Approve the site URL/domain choice from `docs/hosting-options.md`.
4. Record the narration (script in `docs/DEMO.md`), or accept the TTS draft.
5. Post the eligibility question on the Even Discord (draft in `docs/SUBMISSION.md`).

## Decisions

- New repo `pinpoint`; first commit imports Agent Relay pieces unchanged (disclosure, see `PRIOR_WORK.md`).
- Approvals of shell commands are out of scope (Terminal Mode covers them); we review replies, plans, questions.
- Splitter default = `opencode run` with DeepSeek (user's Go subscription), pluggable to Claude/OpenRouter.
- Each app keeps its own npm package (no workspace) to avoid lockfile races between parallel agents.

## Progress log

- 01:50 | scaffold | repo, SPEC, contract, DEMO, server deps, glasses deps | ok | next: spawn wave 1
