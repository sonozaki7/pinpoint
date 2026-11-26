# Pinpoint privacy

Source text for the privacy page on https://pinpoint.qolso.com. Written in plain language. Last updated: 27 November 2026 (hackathon release 1.0.0).

Pinpoint is an app for Even G2 smart glasses. It helps you review work your AI agents have already done, and sends your corrections back to where the work lives.

## The short version

- Pinpoint Cloud keeps **nothing on disk**. Your sample data and your pairing live in memory and are wiped when the server restarts.
- When you connect your own computer, the cloud **passes your data through** and does not store or log it.
- Your **voice** is turned into text and then thrown away. Pinpoint does not keep recordings.
- Your **accounts and tokens** (T3 Code, Notion, Gmail, Telegram) stay on your own computer.
- Pinpoint never sends an email, posts a comment or changes a page without your gesture, and every send has a 5 second undo.
- There are no accounts, no ads and no analytics.

## What Pinpoint is made of

| Part | Where it runs | What it can see |
|---|---|---|
| Glasses app | Inside the Even app on your phone | What is on screen, your taps, your voice while you record |
| Pinpoint Cloud (`pinpoint-api.qolso.com`) | A server we run | Your device id, the sample workspace, and (when paired) the requests passing through |
| Desk | Your own computer, running `npm run desk` | Your agents' output, your Notion pages and Gmail drafts that you choose to review |

## What we store, and where

| Data | Where | How long |
|---|---|---|
| A random device id (a UUID the app makes on first run) | Your phone (Even app storage) and in the cloud's memory | Until you clear the app's storage; cloud forgets it after 7 days idle or a restart |
| Your sample workspace (fictional inbox, your draft notes, sent reviews) | Cloud memory, private to your device id | Until reset, 7 days idle, or a restart |
| A pairing token for your desk | Your phone, plus a SHA-256 hash in cloud memory | Until you press Disconnect, or the cloud restarts |
| The desk's secret | Your computer (`apps/server/.data/desk.json`, owner-only), plus a hash in cloud memory | Until you delete the file |
| Pairing codes | A hash in cloud memory | 10 minutes, single use |
| Your review drafts, cached decks, your last-reviewed text for "changed since your review" | Your computer (`apps/server/.data`) | Until you delete them |
| T3, Notion, Google and Telegram tokens | Your computer, in `.env` and `.data` (Google token is owner-only) | Until you delete them |

The cloud has no database. We do not collect your name, email, location, contacts or advertising ids.

## Your voice

The glasses record only after you tap, and stop about 1.2 seconds after you stop talking (30 seconds at most). The audio is sent as one request and transcribed:

- **Sample workspace:** by whisper.cpp on the Pinpoint Cloud server. The temporary audio file is deleted as soon as the text is produced.
- **Paired desk:** the audio passes through the cloud to your computer, which transcribes it there.

Only the text is kept, as your note. Audio is never stored.

## When you connect your computer (desk pairing)

Your computer connects **out** to Pinpoint Cloud. When your glasses ask for your inbox, the cloud forwards the request over that connection and forwards the answer back. The cloud does not parse, store or log these requests or answers. Our logs contain only the route name, the status, how long it took and an 8-character hash of the device id. No query strings, no bodies.

Important: this is **not end-to-end encrypted**. The cloud ends the TLS connection, so while a request is in flight the cloud process can see it. We do not keep it. If that trade-off is not acceptable for your work, run Pinpoint only on the sample workspace, or on your own network with the local server (`npm run demo` or live mode).

To stop: press **Disconnect** on the phone page, or run `npm run desk -- --unpair-all` on your computer.

## Other services that see your content

Pinpoint is useful because it connects to services you already use. Each sees what it normally would, plus what you choose to send:

| Service | When | What it receives |
|---|---|---|
| **DeepSeek API** | On your desk, when the reviewer model is on (it is how output is sorted and questions are answered) | The text of the work under review (an agent reply, a page, a draft) and your question or edit. Prompts are not logged by Pinpoint. DeepSeek's own terms apply. The sample workspace sends no private text to it. |
| **T3 Code** | Live desk | Your review, as a normal message in the thread |
| **Notion** | Live desk | Your note, as a comment on a block; the page status |
| **Gmail** | Live desk | Your edited draft; Gmail sends it only after you send it |
| **Telegram** | If you configure a bot | The review items you choose, in a private group you own. Telegram's terms apply. |
| **Even Realities** | Always | Even's app and hub handle the glasses connection, installation and your Even account |

Pinpoint reads only what you point it at: the T3 projects named in `T3_PROJECTS`, the Notion database you share with the integration, and Gmail drafts under one label. The Gmail permission is `gmail.modify`, which cannot permanently delete mail.

## Safety by design

- **Pinpoint does not write from nothing.** It reviews work that exists. A correction you speak is applied by exact rules first ("net-45, not net-60"). If a model has to rewrite one sentence, the server checks that nothing else changed.
- **Everything shown can be traced.** Each line is an exact quote of the source. Answers to your questions quote the sentence they came from, or say they found none.
- **Undo.** A 5 second countdown precedes every send. A Gmail send from Telegram asks for a second confirmation on your phone.
- **No command approvals.** Pinpoint never approves shell commands or permission prompts for an agent.
- **Rate limits** protect the service: 300 requests a minute per IP, 120 per device, 20 voice requests per minute per device, 5 pairing attempts per 10 minutes. Request bodies are capped (64 KB JSON, 30 seconds of audio, 2 MB through the relay).
- **Isolation.** Every device has its own sample workspace. One device cannot see another's.

## Your choices

- Use only the free sample workspace. Nothing about you is connected.
- Disconnect your computer at any time. The phone returns to the sample.
- Delete `apps/server/.data` on your computer to remove everything Pinpoint cached.
- Revoke access from the services themselves: your Notion integrations page, your Google account's third-party access page, and @BotFather for the Telegram bot.
- Clear the Even app's storage for Pinpoint to remove the device id.

## Children

Pinpoint is not directed at children.

## Changes and contact

If this page changes, the date at the top changes. Questions: TODO(lead): add a contact email or GitHub issues link for the privacy page (do not use a personal address by accident). Source: https://github.com/sonozaki7/pinpoint.

## Notes for maintainers (not part of the site page)

- Everything above is checked against `docs/desk-pairing.md`, `apps/server/CLOUD.md`, `apps/server/src/cloud/limits.ts` and `apps/server/src/voice/service.ts` (temporary audio is removed in a `finally`).
- TODO(lead): verify that no cloud environment sets `DEEPSEEK_API_KEY` for the sample workspace, or reword the DeepSeek row: `createLlmConnector` can use a key in cloud mode "as the optional answer phraser", which would send the fictional sample text to DeepSeek.
- TODO(lead): the Even app's own privacy policy and store listing text must cover each permission (network, microphone) before store review; this page can be linked from the listing.
