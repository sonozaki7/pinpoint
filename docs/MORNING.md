# Morning checklist

About 15 minutes, plus the optional narration. Deadline: Monday 30 November, 04:59 JST. Aim to submit on Sunday night.

Do the steps in order. Step 3 needs your reply before the assistant can publish anything.

## 1. Create the Telegram bot and group (5 minutes)

Follow [telegram-setup.md](telegram-setup.md), steps 1 to 4. In short:

1. In Telegram, open @BotFather and send `/newbot`. It gives back a bot token (the password for the bot).
2. Create a private group named `Pinpoint Desk` and turn Topics on.
3. Add the bot as an administrator with **Manage Topics** allowed.
4. Post any message in the group, then read the group's chat id (the number starting with `-100`) from the bot's update list.

Put both values in `apps/server/.env`:

```dotenv
TELEGRAM_BOT_TOKEN=<the token from BotFather>
TELEGRAM_CHAT_ID=-100...
```

That file is ignored by Git. Never paste the token into chat, a screenshot, or the submission.

## 2. Run the Telegram check and take two screenshots (2 minutes)

```sh
npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs
```

The script creates the topic, posts the header, the full plan, the composed review and both quote-replies, then prints a link for every message. If the token or chat id is missing it explains what to add and exits without contacting Telegram.

On the phone, take two screenshots:

1. The topic with the plan, saved as `demo/recordings/telegram-topic.png`.
2. The two quote-replies on the exact plan sentences, saved as `demo/recordings/telegram-quotes.png`.

If a quote-reply shows as a plain reply instead, the plan text changed. Tell the assistant.

## 3. Reply "public" in the chat (1 minute)

The repository, the site and the video are ready but not published. Reply `public` to the assistant. It will then:

1. Make `sonozaki7/pinpoint` public on GitHub.
2. Turn on GitHub Pages for the site at https://sonozaki7.github.io/pinpoint/ .
3. Upload the final render, `demo/out/pinpoint-demo-v2.mp4`, as `pinpoint-demo.mp4` on release `v1.0.0`. A release is a downloadable file attached to a version tag, so the video link in the README and the form will open and play.
4. Put the same file and the newer poster into the site's media folder, because the page plays `media/pinpoint-demo.mp4`.

Nothing is released to a customer. This only publishes the hackathon entry.

## 4. Optional: record the narration (10 to 15 minutes, skippable)

The current cut uses the local Kokoro voice. To use your own voice, follow [narration.md](narration.md):

1. Record the 29 lines.
2. Save the take as `demo/film/public/audio/pinpoint-voice-final.mp3`.
3. Point the film at it in `demo/film/src/clips.json`.
4. Rebuild and export the video.

If you skip this, keep the Kokoro voice. The video is already complete either way.

## 5. Post the eligibility question in Discord (1 minute)

Copy the message under "Eligibility question for Discord" in [SUBMISSION.md](SUBMISSION.md) and post it in the hackathon Discord. It asks whether T3 Code counts as the core integration, and offers to adjust.

## 6. Fill in the DoraHacks form (3 minutes)

| Field | What goes in it |
|---|---|
| Project name | Pinpoint |
| Tagline | Ring for where. Voice for what. |
| Short description | The 143-word block in [SUBMISSION.md](SUBMISSION.md), under "Short description". |
| Long description | The 384-word block in the same file, under "Long description". |
| Website | https://sonozaki7.github.io/pinpoint/ |
| Demo video | https://github.com/sonozaki7/pinpoint/releases/download/v1.0.0/pinpoint-demo.mp4 |
| Source code | https://github.com/sonozaki7/pinpoint |
| Tracks | AI Assistants & Work (main). Messaging & News (second). |
| Feature requests | The five items in [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md); the short list is in SUBMISSION.md. |
| Attachments | `apps/glasses/pinpoint.ehpk` |
| Screenshots | The two Telegram screenshots from step 2, plus 2 to 3 from `demo/shots/`. |

Build the app package if it is missing or older than the app code:

```sh
npm --prefix apps/glasses run pack
```

The file it writes is `apps/glasses/pinpoint.ehpk`.

## Final check before you press submit

- The site opens in a private window.
- The video link plays without a login.
- The repository opens without a login.
- The two Telegram screenshots are attached.
- The form shows both tracks.
- The description word counts are still under 150 and 400 if you edited them.
