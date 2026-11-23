# Pinpoint

**Ring for where. Voice for what.**

Review your AI agents' work from Even G2 — point by point, with the precision of your laptop.

**Demo video:** placeholder — link added before submission (under 3 minutes) · **Site:** https://sonozaki7.github.io/pinpoint/

![Pinpoint review screen in the Even Hub simulator](demo/shots/glasses-02-review.png)

*Simulator capture, not physical glasses.*

Pinpoint turns a long agent reply into a short list of one-line points. You move through them with the ring, say nothing when a point is fine, and speak only about the point that is wrong. It then sends one cited review back to the agent. It runs as an Even Hub app (an app for the glasses, loaded through Even's phone app), a local server next to T3 Code (the open-source harness that runs coding agents such as Claude Code and Codex), and a Telegram companion.

## The problem

Coding agents write plans and replies that are hundreds of words long, then stop and wait for a person. Today's glasses tools let you approve a prompt or say one sentence. That is not feedback.

*Everyone built "approve from your glasses". Approval isn't feedback.*

Approval is a yes/no. What actually steers an agent is which step or claim is wrong, and why. On a laptop that takes selecting text and writing a sentence. On a 576 × 288 display, selecting text is not possible.

## How it works

**Split → Point → Send.**

1. **Split.** The server takes the agent's reply or plan and splits it into 4–10 one-line points. Each point carries an exact quote from the source. A point whose quote cannot be found is repaired from the source or dropped, so the glasses never show invented text.
2. **Point.** The list appears on the G2. Swipe to move, tap to talk. Silence means agree. Tap, say one sentence, tap to stop: that point becomes an objection or a note. A question from the agent becomes a list of options, one tap each.
3. **Send.** One more tap composes a review that cites each point by number and quote, then sends it to the agent as a normal message in its thread.

*Silence means agree. You only speak when something's wrong.*

A review sent from the 7-step `auth-refresh-fix` plan in demo mode:

```
Review from G2 (Pinpoint) — 7 points
✗ 4. "Force-logout every user by truncating the sessions table" → No. Migrate existing sessions instead.
✗ 6. "Wrap refreshToken() in a mutex." → Use a request queue; a mutex deadlocks with the retry path.
● 5. "Backfill rotated_at for old rows." → Make it a separate job.
✓ Agreed: 1, 2, 3, 7. Go ahead with the rest of the plan.
```

Two objections and one note, each attached to the exact line it refers to. For a question, the same line answers with the chosen option: `? 2. "Upgrade to Vite 7 now?" → Stay on 6 for now.` The agent can act on that; "approved" tells it nothing.

## Why glasses, and why not just the phone

Pinpoint is for the time away from the laptop: walking, on a train, between meetings. A phone works there, but it needs both hands and pulls your eyes down. Glasses leave your hands free and your attention on the room.

The display is also a useful constraint. A ten-line budget forces a long agent plan down to the decisions that matter, and the review you send is shorter and more specific than what most people type on a laptop.

The ring (the Even R1) is the whole input model: swipe for where, tap to talk, tap to stop. No keyboard, no scrolling a wall of text.

A phone still does two things better, so Pinpoint uses it: alerts while the glasses app is closed, and reading long technical text in full. See below.

## Telegram companion

Pinpoint mirrors each thread that needs you into its own topic in one private Telegram group ("Pinpoint Desk"):

- A header: `Needs you · plan · 7 points`, with an **Agree all & continue** button.
- The full agent reply, formatted, so you can read code blocks on the phone.
- Your review appears as a reply, and each objection or note appears as a quote-reply on the exact sentence it refers to.
- **Read on phone** in the glasses menu posts a marker on the current point and returns a `t.me` link to it.

This covers the glasses' two real gaps: the phone's notification shows up on the glasses while the app is closed, and the phone holds the full text when ten lines are not enough.

Setup, dry-run mode, and troubleshooting: [docs/telegram-setup.md](docs/telegram-setup.md).

## Architecture

```
Even G2 + R1  ── touch, mic ──►  Even app on the phone (WebView)
      ▲                                   │
      └──────── display ──────────────────┤   apps/glasses
                                          │   TypeScript, Even Hub SDK
                                          │
                                          │ HTTP, 127.0.0.1:8787
                                          ▼
                                   apps/server  (Node 22, Hono)
                                   ├─ inbox       which threads need you
                                   ├─ splitter    reply → quoted points (LLM)
                                   ├─ deck        points, drafts, composer
                                   ├─ voice       PCM → text
                                   ├─ t3          T3 Code HTTP + WebSocket
                                   └─ telegram    topics, quote-replies, links
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
              T3 Code  (127.0.0.1:3773)            Telegram Bot API
              Claude Code / Codex threads          one topic per thread
```

The glasses app talks only to the local server. It holds no keys. All credentials live in `apps/server/.env`, which is ignored by Git.

## Quick start (demo mode)

No T3 Code, no Telegram bot, no API key. Node.js 22.13 or newer.

Terminal 1 — server:

```sh
npm --prefix apps/server ci && PINPOINT_MODE=demo npm --prefix apps/server start
```

Terminal 2 — glasses preview:

```sh
npm --prefix apps/glasses ci && npm --prefix apps/glasses run dev
```

Open `http://127.0.0.1:4173`. The page shows the glasses screen; the buttons below it act as the touchpad and ring (up, down, tap, double tap, menu). The preview reads the demo server at port 8787. To see the screen with built-in sample data and no server at all, open `http://127.0.0.1:4173/?mock=1`.

Terminal 3 — the official Even Hub simulator:

```sh
npm --prefix apps/glasses run simulator -- http://127.0.0.1:4173
```

Check the server is up:

```sh
curl -s http://127.0.0.1:8787/api/health
# {"ok":true,"mode":"demo","t3":"off","telegram":"dry-run","splitter":"fixture"}
```

In demo mode you get four fixed threads: `auth-refresh-fix` (plan, 7 steps, step 4 is destructive), `deps-upgrade` (a question with three options), `flaky-e2e` (a failed run), and `inbox-morning` (a report with four draft replies). Sending writes the review to the server log and to the Telegram dry-run log. Nothing leaves the machine.

## Live mode with T3 Code

Pinpoint reads T3 Code 0.1.11 (orchestration protocol 2) on the same Mac. Start T3 Code first.

1. Create a scoped token:

   ```sh
   ~/.t3/bin/t3 auth session issue \
     --scope orchestration:read \
     --scope orchestration:operate \
     --ttl 7d \
     --label pinpoint-t3-client \
     --token-only
   ```

2. Copy the example settings and fill them in:

   ```sh
   cp apps/server/.env.example apps/server/.env
   ```

   ```dotenv
   PINPOINT_MODE=live
   T3_URL=http://127.0.0.1:3773
   T3_TOKEN=<the token from step 1>
   T3_PROJECTS=pinpoint
   SPLITTER_PROVIDER=opencode
   ```

3. Restart the server. `GET /api/health` should report `"t3":"ok"`.

`T3_PROJECTS` is required. It is a comma-separated list of project ids or exact project titles, and the server refuses to start in live mode without it. Only threads from those projects are read.

The splitter needs a model: the `opencode` CLI by default, or `SPLITTER_PROVIDER=anthropic` / `openrouter` with the matching key. If it fails or times out, the server falls back to a simple sentence split so the flow still works.

How the T3 side behaves, including the exact attention rules and the live test results: [docs/t3-api-notes.md](docs/t3-api-notes.md).

## Privacy and safety

- **Keys stay on the server.** The T3 token, Telegram bot token, and model keys are read from `apps/server/.env`, which is gitignored. The glasses app has no secrets; its manifest asks only for network access to `http://127.0.0.1:8787` and the glasses microphone.
- **Project allowlist.** Live mode reads only the T3 projects named in `T3_PROJECTS`, and refuses to start if the list is empty. The rest of your T3 workspace is never queried.
- **Nothing proceeds until you send.** Swipes and voice notes edit a local draft that is saved as you go. The agent is contacted only when you tap the send row and confirm the preview. Leaving the screen keeps the draft; it does not send it.
- **No approvals of shell commands.** Pinpoint does not approve command, file, or permission prompts, and never runs tools on its own. That is out of scope; Even's Terminal Mode already covers it. A review is a normal user message, not an approval token, so the agent still decides what to do with your feedback.
- **Read only until send.** On the T3 side, the client reads the thread list, one thread's details, and its transcript. The only writes are the review message and an answer to a pending question you chose.
- **Telegram is yours.** One bot, one private group, one poller. The token appears only in the call to Telegram and is never written to logs, errors, or Git.
- **Demo data is fictional.** The four demo threads describe an invented web app.

## What existed before Nov 23

The hackathon rules require this disclosure: [PRIOR_WORK.md](PRIOR_WORK.md).

In short, the repository starts from three parts of **Agent Relay** (same author, MIT, built Nov 6–8, 2026), imported unchanged at the first commit: the Even Hub glasses scaffold, the Remotion film project, and a read-only T3 status bridge kept for reference. Everything built on top — the server, splitter, composer, review store, voice path, T3 client, Telegram module, glasses screens, demo fixtures, and site — was written during the Heads Up hackathon, Nov 23–29, 2026.

## Tracks

| Track | What Pinpoint contributes |
|---|---|
| **AI Assistants & Work** (main) | Review and correct Claude Code / Codex work, run by T3 Code, from the glasses. Point-by-point feedback, not a yes/no. |
| **Messaging & News** (second) | Telegram as the phone-side companion: per-thread topics, full replies, quote-replies on exact sentences, a one-tap agree. |
| **Best Telegram integration** (special prize) | Bot API topics, HTML formatting, quote-replies with a validated fallback, deep links, and a button that sends an agree-all reply. |

## Limitations

- **Simulator only.** Everything was built and tested in the official Even Hub simulator. No physical G2 or R1 was available, so real-world legibility, BLE timing, and ring-vs-temple input are unverified.
- **The ring/temple distinction is not shown in the simulator**, and the long-press source field is contradictory in Even's docs and SDK types. Pinpoint does not depend on it.
- **The splitter can misread unusual replies.** Quotes are checked against the source and bad points are repaired or dropped, but an odd reply can produce a weaker list.
- **T3 Code's API is beta.** Live mode was verified against 0.1.11, protocol 2, on one machine. A future version may need client changes.
- **Local and single-user.** The server binds to `127.0.0.1`, has no login, and is not meant to be exposed to a network. The packaged app's network permission allows only that loopback address, so running it on a phone against a server on another computer would need a second permission entry and a reachable address.
- **Transcription is server-side**, through T3's endpoint or a local Whisper model. Nothing is transcribed on the glasses.

## Credits

Built by [sonozaki7](https://github.com/sonozaki7) for the Heads Up hackathon (Even Realities × TVM Ventures), November 2026.

This is an independent project. It is not affiliated with, endorsed by, or sponsored by Even Realities, the T3 Code project, Telegram, or the hackathon organizers. Even G2, Even R1, and Even Hub are products of Even Realities; Claude Code and Codex belong to their respective owners.

The glasses scaffold and film project come from the author's earlier Agent Relay project, as described in [PRIOR_WORK.md](PRIOR_WORK.md).

## License

MIT. See [LICENSE](LICENSE).
