# Goal: Pinpoint submission-ready for Heads Up (deadline Mon Nov 30 04:59 JST)

Status: active · Delivery boundary: public repo + live site with a try-it simulator + demo video + .ehpk + DoraHacks submission (the submission itself needs the owner)
Spec: `docs/SPEC.md` · Host advice: `docs/host-qa-notes.md` · Device risks: `docs/device-readiness.md`

## Run card

- Objective: Pinpoint = review and steer everything your AI prepared, from G2 + R1, without the phone. Main track AI Assistants & Work (Gmail, Calendar, Notion, OpenRouter), second track Messaging & News (Telegram first), plus Best Telegram integration.
- Hero use case ("Morning brief"): walking to work, the glasses show what your assistants prepared: email replies, a meeting move, a Notion task, a Telegram reply, your coding agents' plans. Scroll, skip what's fine (silence = yes), tap and say the one fix, double-tap: everything happens, a receipt shows on the glasses, corrected items come back once for a glance.
- Cost rule (owner): all coding/testing/research by DeepSeek V4.1 Flash delegates (OpenCode Go). Opus plans, reviews, commits. No paid services without asking (hosting = owner's VPS new-prod).
- Internal deadlines (JST): feature freeze Sun 29 12:00 · final video Sun 18:00 · submit Sun 22:00.
- Open blockers (owner, Fri morning): Google OAuth consent (≈10 min, docs/connectors.md), Notion integration token, OpenRouter key (optional), Even developer portal: upload .ehpk as Beta + 24×24 icon.

## Task board

| ID | Task | Owner | Status |
|---|---|---|---|
| C1 | Cloud mode (per-device sample workspace, whisper, limits) | DeepSeek | done (a44a548) |
| C2 | Deploy Pinpoint Cloud on new-prod (pinpoint-api.qolso.com) | DeepSeek | running |
| G1 | Glasses: real-device defaults, device id, phone page, lifecycle | DeepSeek | running |
| R1 | Device readiness audit | DeepSeek | done (e4e50ed) |
| V3 | Video v3 pipeline (one bad step, one fix) | DeepSeek | running → becomes v4 with the Morning brief |
| T1 | Telegram redesign (card, status, one note per sentence, legend) | DeepSeek | running |
| K1 | Connectors: Gmail, Calendar, Notion, OpenRouter + seed + setup scripts | DeepSeek | running |
| S1 | Morning brief engine: build actions deck, execute on send, revise noted items, receipts | DeepSeek | after G1 (needs 'actions' attention) |
| G2 | Glasses: audit P0/P1 fixes, app tags/flags, receipt screen, revised follow-up, fewer symbols | DeepSeek | after G1 |
| W1 | Web simulator site: real app code + browser mock backend + datasets + app panels | DeepSeek | after G1 |
| T2 | Telegram: receipts with links, chat reply drafts from picked groups, Slack/Discord adapters | DeepSeek | after T1 |
| P2 | Desk pairing relay (real G2 reaches your own desk anywhere) | DeepSeek | after S1 |
| D1 | README, SUBMISSION, FEATURE_REQUESTS, business model, privacy page, 24×24 icon | DeepSeek + Opus | Sat |
| X1 | Real end-to-end run with owner's Google/Notion (demo label/calendar) + footage | DeepSeek | Sat |

## Decisions

- New repo `pinpoint`; first commit imports Agent Relay pieces unchanged (disclosure, see `PRIOR_WORK.md`).
- Hosting: owner's VPS new-prod (shared production box: ledger every root action, touch nothing existing). Fly.io not used.
- Real Google/Notion data is limited to a "pinpoint" Gmail label, a "Pinpoint demo" calendar and a "Pinpoint demo" Notion page. Nothing outside them is read or changed.
- Corrected (noted) items are revised and shown once more before they go out; agreed items run on send.
- The website's main job is the try-it simulator, built from the real glasses code.

## Progress log

- 2026-11-24 night | first build: simulator-verified app, live T3 run, video v2, site, Telegram bot.
- 2026-11-27 00:30 | owner: video too complex, real-G2 doubts, Telegram confusing, wants Google/Notion + web simulator. Replanned (this file).
