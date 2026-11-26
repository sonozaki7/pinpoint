# DoraHacks BUIDL form: paste-ready

Every field of the Heads Up submission, in form order. Anything in `TODO(lead)` or `RELEASE_URL` / `VIDEO_URL` must be filled in before pressing submit. Steps for the owner: [SUBMIT-CHECKLIST.md](SUBMIT-CHECKLIST.md).

## Project name

Pinpoint

## Tagline

The attention layer for your AI agents, on Even G2 + R1.

(Alternative, 50 characters: *Point at the line. Say the fix. Silence agrees.*)

## Short description (limit 300 words; about 290 words)

AI agents now do real work all day, but they still need a person several times a day. Their tools are text-heavy and offer approve or decline. With many projects running, you lose track, miss the moment an agent needs you, and miss the one wrong detail inside a plan you approved.

Pinpoint is the attention layer for your agents on Even G2 + R1. It shows only what needs you, with a glance status ("2 need you · 3 working") and a "since you looked" catch-up. It sorts long output down to the decisions: "7 steps · 1 needs you", with a grounded reason on the flagged line, such as "Your notes say net-45". You point at the exact line with the ring and say the fix. Silence means agree. You can ask a question and get the exact sentence that answers it, and hand off a new task by one spoken sentence.

Your words land where they belong: the agent's thread in T3 Code (Codex and Claude Code), a Notion comment on the exact block, the Gmail sentence edited in place, a Telegram quote-reply on the same sentence. Pinpoint never writes a reply from nothing; it reviews work that exists. Each flow takes fewer gestures than a phone, and tests enforce that: a flagged mistake takes 3 taps and 1 spoken sentence. Every send has a 5 second undo.

It works out of the box on a sample workspace through Pinpoint Cloud, and pairs with your own computer in three steps. It is for developers running agents across projects, and for anyone with an assistant drafting emails and plans.

Built and tested in Even's official simulator; no G2 hardware was available. Open source (MIT); prior work is disclosed in the README.

## Tracks

- **Main track:** AI Assistants & Work
- **Second track:** Messaging & News

Why both: the work comes from AI assistants (T3 Code, Notion, Gmail); Telegram is a full companion for messages (topics, quote-replies, receipts).

## Special prize note: Best Telegram integration

Telegram is a first-class surface, not a notification hook. Each task, Notion page or Gmail draft gets its own topic in a private forum group, with a status icon in the topic list (❗ needs you, ✅ reviewed, ‼ failed). The topic holds one notifying card with buttons (Agree all, Approve, Send as written with a phone confirmation, answer buttons for an agent's question), the full text collapsed, one **quote-reply on the exact sentence** for each note you spoke on the glasses, and a receipt that links to where it landed (the agent thread, the Notion block, the sent email). "Read on phone" from the glasses posts the paragraph around the line you are on. Tested against a real bot; a dry-run mode runs the same code with no bot. Details: [telegram-setup.md](telegram-setup.md). Real-bot screenshots: `demo/recordings/telegram-*.png`.

## Demo video

- Primary: https://pinpoint.qolso.com/media/pinpoint-demo.mp4
- GitHub release copy: RELEASE_URL
- Video URL for the form: VIDEO_URL <!-- TODO(lead): the final public URL, after the video is uploaded (the site path or a release asset) -->

## Repository

https://github.com/sonozaki7/pinpoint (public, MIT)

## Website and live demo

https://pinpoint.qolso.com (the page includes a try-it simulator). Cloud API: https://pinpoint-api.qolso.com

## App package

`apps/glasses/pinpoint.ehpk`, also attached to the release: RELEASE_URL. Build it with `npm --prefix apps/glasses run pack`. Package id `com.sonozaki7.pinpoint`, version 1.0.0, SDK 0.0.16.

## How to test (for judges)

**Fastest (no install, 1 minute):** open https://pinpoint.qolso.com and use the simulator on the page. It runs the real glasses app with a virtual R1 ring and real voice, on a private sample workspace.

1. Open the item that needs you. The cursor is already on the flagged line.
2. Tap, say a fix ("Don't log everyone out, migrate the sessions"). It stops by itself.
3. Tap the send row. You have 5 seconds to undo. Your inbox moves to the next item.
4. Hold the menu → Ask, and say "How many sessions are affected?". Check the answer's quote against the text.

**Official Even Hub simulator:** `git clone https://github.com/sonozaki7/pinpoint && cd pinpoint && npm run demo`, then in a second terminal `npm --prefix apps/glasses run simulator -- http://127.0.0.1:4173`. Needs Node.js 22.13 or newer. No keys.

**Real G2:** scan the QR at https://pinpoint.qolso.com/app/ from the Even app's Even Hub tab (developer section → Scan QR), or load the `.ehpk`. Needs Even app 2.2.10 or newer, with your Even account signed in at hub.evenrealities.com and the app restarted once. QR builds stop when the phone locks (Even's documented dev-mode limit); keep the phone awake. The app starts on its own sample workspace through Pinpoint Cloud, so nothing else is needed. <!-- TODO(lead): verify https://pinpoint.qolso.com/app/ serves the glasses build and the packaged whitelist matches before submit -->

**With your own agents:** `cd apps/server && npm install && npm run desk`, then enter the printed code in the Pinpoint phone page (**Connect your computer**). See [desk-pairing.md](desk-pairing.md). Needs T3 Code running and `T3_PROJECTS` set; Notion and Gmail need your own tokens ([connectors.md](connectors.md)).

**Automated checks:** `npm run check`. <!-- TODO(lead): fill in final test counts after the last commit (apps/server vitest, apps/glasses node test) -->

## Team

- **sonozaki7** (solo): design, glasses app, server, connectors, site and film. <!-- TODO(lead): real name / DoraHacks handle, Discord handle for eligibility post -->

AI coding agents (Claude Code, Codex, OpenCode with DeepSeek) were used to write parts of the code under the owner's direction.

## Prior work disclosure

The repository's first commit imports three pieces of the author's earlier **Agent Relay** project (MIT, built Nov 6–8, 2026), unchanged: the Even Hub app scaffold (`apps/glasses`), the Remotion film project (`demo/film`) and a read-only T3 status bridge (`reference/agent-relay-bridge`). Everything committed afterwards was built Nov 23–29, 2026. [PRIOR_WORK.md](../PRIOR_WORK.md).

## Feature requests (up to 5)

Short form for the form field; full text in [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md).

1. **Even Hub SDK: a glanceable alert while the plugin is not focused.** Plugins get no push notifications, so an app whose job is "tell me when something needs me" must borrow another app's notifications.
2. **Even Hub: an on-device or hosted AI API, speech-to-text first.** Every voice app now runs and pays for its own transcription server.
3. **Even Hub SDK: a guaranteed `eventSource` (ring, right temple, left temple) on every input event, including long press.** Docs and SDK types disagree today, and the simulator cannot show the difference.
4. **Even Hub SDK: range emphasis and rich text inside a text container.** Brightness is per container and a page holds 8, so a cited sentence cannot be marked inside a paragraph without rebuilding the page.
5. **Even Hub: a shareable private install link and a published review time.** Today a judge needs a tester invitation or a QR build that dies when the phone locks.

## Other fields

| Field | Value |
|---|---|
| Category / tags | AI, Productivity, Telegram, Notion, Gmail, AI agents, Voice |
| Logo | `brand/pinpoint-avatar-512.png` (24×24 Hub icon: `apps/glasses/icon-24.png`) |
| Cover image | `apps/site/media/og.png` (1200×630) <!-- TODO(lead): confirm this is the final cover image --> |
| Screenshots | 3 from `demo/shots/` (inbox, review, note), 1 Telegram topic (`demo/recordings/telegram-v2-card.png`), 1 Notion comment (`demo/recordings/notion-launch-comment.png`) |
| License | MIT |
| Contact | Discord (see checklist) |

## Notes for the lead

- The old long description (384 words) is retired. If the form has a "details" field longer than 300 words, reuse the sections of the README: Why, What it does, Integrations, Honest notes.
- Do not claim hardware testing anywhere. Say "Even's official simulator".
