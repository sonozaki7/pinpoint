# Goal: Pinpoint submission-ready for Heads Up (deadline Mon Nov 30 04:59 JST)

Status: submission-ready (owner steps left) · Delivery boundary: public repo + live site with a try-it simulator + demo video + .ehpk + DoraHacks submission (the submission itself needs the owner)
Spec: `docs/SPEC.md` · Host advice: `docs/host-qa-notes.md` · Device risks: `docs/device-readiness.md`

## Run card

- Objective: Pinpoint = review work your AIs already did, point by point, from G2 + R1, and put your words exactly where they belong. Main track AI Assistants & Work (Claude Code / Codex via T3 Code, Notion, Gmail), second track Messaging & News (Telegram companion), plus Best Telegram integration.
- Scope (decided 2026-11-27 from docs/landscape.md; owner rejects AI slop): sources = coding agents (core), Notion pages waiting for review (notes become comments on the exact block), Gmail drafts an agent wrote (stretch; notes applied, shown once, then sent). No AI-drafted replies from nothing, no inbox triage, no meeting briefs, no calendar moves, no OpenRouter.
- Pitch: "Approval isn't feedback." ~40 G2 coding-agent apps approve/deny or dictate; nobody lets you point at the exact line. Silence means agree.
- Cost rule (owner): all coding/testing/research by DeepSeek V4.1 Flash delegates (OpenCode Go). Opus plans, reviews, commits. No paid services without asking (hosting = the owner's VPS).
- Internal deadlines (JST): feature freeze Sun 29 12:00 · final video Sun 18:00 · submit Sun 22:00.
- Open blockers (owner, Fri morning): Google OAuth consent (≈10 min, docs/connectors.md), Notion integration token, DeepSeek key (optional), Even developer portal: upload the .ehpk as Beta (the 24×24 icon is in the repo).

## Task board

| ID | Task | Owner | Status |
|---|---|---|---|
| C1 | Cloud mode (per-device sample workspace, whisper, limits) | DeepSeek | done (a44a548) |
| C2 | Deploy Pinpoint Cloud on the owner's VPS (pinpoint-api.qolso.com) | DeepSeek | container live (4 sample items); public HTTPS waits on owner's DNS A record, then `deploy/setup-https.sh` |
| G1 | Glasses: real-device defaults, device id, phone page, lifecycle | DeepSeek | done (c2d14c5) |
| R1 | Device readiness audit | DeepSeek | done (e4e50ed) |
| V3 | Video v3 (one bad step, one fix), 1:43 | DeepSeek | done (b8d625a); v4 after new screens + real Notion/Gmail/Telegram |
| T1 | Telegram redesign (card, status, one note per sentence, legend) | DeepSeek | done (6d8f333), live in the group |
| K1 | Connectors + setup/seed scripts | DeepSeek | done (2f75da1), trimmed in de34478 |
| S1 | Review sources: Notion page review + Gmail draft in-place edits; receipts | DeepSeek | done (de34478); live Notion/Gmail wait on owner sharing/consent |
| G2 | Glasses: audit P0/P1 fixes, calm screen, CHECK flags, 24×24 icon | DeepSeek | done (38b0d5a) |
| G3 | Glasses: gesture budget (docs/ux-budget.md) + budget tests | DeepSeek | running |
| W1 | Web simulator site: real app code + browser mock backend + datasets (coding agents; docs & drafts) + app panels | DeepSeek | running |
| L1 | Landscape research (store 1,148 apps, 113 hackathon builds) | DeepSeek | done (cb244ab) |
| T2 | Telegram: question buttons, Notion/Gmail cards, receipts, agent replied | DeepSeek | running |
| P2 | Desk pairing relay (real G2 reaches your own desk anywhere) | DeepSeek | after S1 |
| D1 | README, SUBMISSION, FEATURE_REQUESTS, business model, privacy page, 24×24 icon | DeepSeek + Opus | Sat |
| X1 | Real end-to-end run with owner's Google/Notion (demo label/calendar) + footage | DeepSeek | Sat |

## Final push (2026-11-27 03:30 JST, owner: "ready for submission by today"; this time Claude Sonnet 5.5 agents, not DeepSeek)

Delegation rule from 22:30 JST: Claude for at most 1–2 subagents (the video); everything else on DeepSeek V4.1 Flash (OpenCode Go). Failed agents are resumed in their own thread, keeping their work.

| ID | Task | Status |
|---|---|---|
| F1 | Server: DeepSeek-API sorting/evidence/Ask, changed, glance status, catch-up, new task by voice, everyday + persona samples, cloud secrets | done (8407ec8), cloud redeployed |
| F2 | Glasses: needs-you collapse + Why, Ask, status line, catch-up, New task, sample persona, budgets | done (3be2c16) |
| F3 | Website: minimal 3D hero + POV outdoors, animated hand controller, Developer/Everyday switch, privacy page, /app/ + QR | done and live (1c5c806, phone polish af255f3; Chromium, Firefox, WebKit) |
| F4 | Video: attention-layer story, developer walk + everyday parent, real Codex runs, real Notion/Gmail/Telegram proof | done: 2:44 film (1166076), on the site and the v1.1.0 release |
| F5 | README, SUBMISSION, FEATURE_REQUESTS, privacy, stale docs, submit checklist | done (26795b7, 3c4acf5, 1f1f59f); only the team line waits on the owner |
| F6 | Lead: integrate, deploy cloud (+DeepSeek key on server), release (ehpk + video), site deploy, sandbox thread cleanup, QA | done: one inbox order (4be7eb9, cloud redeployed), Send-row fix (fbe17b0), release v1.1.0, 10 test threads archived, temp copies removed |

## Decisions

- New repo `pinpoint`; first commit imports Agent Relay pieces unchanged (disclosure, see `PRIOR_WORK.md`).
- Hosting: the owner's VPS (shared production box: ledger every root action, touch nothing existing). Fly.io not used.
- Real Google/Notion data is limited to a "pinpoint" Gmail label, a "Pinpoint demo" calendar and a "Pinpoint demo" Notion page. Nothing outside them is read or changed.
- Corrected (noted) items are revised and shown once more before they go out; agreed items run on send.
- The website's main job is the try-it simulator, built from the real glasses code.

## Progress log

- 2026-11-24 night | first build: simulator-verified app, live T3 run, video v2, site, Telegram bot.
- 2026-11-27 00:30 | owner: video too complex, real-G2 doubts, Telegram confusing, wants Google/Notion + web simulator. Replanned (this file).
- 2026-11-27 02:30 | gesture budget rule added (docs/ux-budget.md); Telegram redesign live; review sources done; cloud redeployed with 4 sample items.
- 2026-11-27 01:50 | owner: no AI slop, check existing apps. Landscape research → scope locked to review sources (agents, Notion, Gmail drafts). Notion token saved; Google client + DNS record pending from owner.
- 2026-11-27 22:40 | website live (1c5c806: hint lines match the fixtures, dentist task asks instead of booking, privacy DeepSeek row covers cloud Ask); video resumed; DeepSeek on phone polish and release prep/QA.
- 2026-11-27 23:50 | release v1.1.0 published (ehpk 80,184 B + 2:44 film); site serves the film; cloud uses the shared inbox order; owner steps left: team line, Discord post, DoraHacks form, optional Even portal beta.
