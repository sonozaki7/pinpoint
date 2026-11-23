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
| W1 | Glasses app per SPEC §10 (demo + live via server API), simulator screenshots | DeepSeek | running | |
| W2 | Server core: HTTP API, decks, splitter + quote verification, composer, voice, demo mode, tests | DeepSeek | running | |
| W3 | T3 client + `docs/t3-api-notes.md`, live attention + send to a sandbox thread | DeepSeek | running | |
| W4 | Telegram module (dry-run + real mode), tests | DeepSeek | running | |
| W5 | Recon: user's domains + fastest static hosting, `docs/hosting-options.md` (read-only) | DeepSeek | running | |
| W6 | Demo fixtures (4 threads + decks) + simulator recording script | DeepSeek | running | |
| W7 | Landing site (after W5) | — | queued | |
| W8 | Video edit in Remotion (after W1+W6) | — | queued | |
| W9 | Integration test: glasses ⇄ server ⇄ T3 live | — | queued | |
| W10 | README, SUBMISSION.md, FEATURE_REQUESTS.md, .ehpk | — | queued | |

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
