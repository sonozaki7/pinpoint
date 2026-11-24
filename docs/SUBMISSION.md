# DoraHacks submission copy

Paste-ready fields for the Heads Up submission. Word counts below are for the description body only, including the tracks line.

- Short description: **143 words** (limit 150).
- Long description: **384 words** (limit 400).

## Short description (150 words max)

AI coding agents write long plans and replies, then stop and wait for a person. Today's glasses tools let you approve, or say one sentence. That is not feedback. Pinpoint is for developers who run agents such as Claude Code and Codex through T3 Code, away from the laptop.

Pinpoint splits each agent reply into 4–10 one-line points, each tied to an exact quote. On Even G2 you swipe to a point, stay silent to agree, or tap and speak one correction. One tap sends a review that cites every point it changes. In a live run, a 7-step plan took 20.4 s to review, and the agent answered 7.3 s later. Telegram carries the same thread as a topic, with the full text and quote-replies.

Tracks: AI Assistants & Work (main), Messaging & News (second), plus the Best Telegram integration special prize.

## Long description (400 words max)

**The problem.** AI coding agents write replies of several hundred words, then stop and wait. On a laptop you answer by selecting a sentence and writing a correction. On glasses you can approve a prompt or dictate one sentence. Neither says which step is wrong, or why.

**Who it is for.** Developers who run coding agents such as Claude Code and Codex through T3 Code, away from the keyboard when one stops.

**How it works.** Pinpoint reads the T3 Code threads that need a person: a plan, a question, a failed run, or a report. The server splits it into 4–10 one-line points. Every point carries an exact quote; an unmatched quote is repaired or dropped, so the glasses never show invented text.

On the G2 the list is four rows at a time. Swipe to move the focus. Silence means agree. Tap, speak one sentence, tap again: the point becomes an objection or a note. An agent question becomes options, one tap each. One tap then composes a review that cites each changed point by number and quote, shows a preview, and sends it as a normal message. The agent reads it as feedback and continues.

**Verified.** In the official Even Hub simulator, a live T3 Code thread was reviewed from the glasses in 20.4 s. Two notes were sent, and the agent replied in 7.3 s. The splitter matched 5 of 5 quotes on a real reply, 155 server tests and 19 glasses tests pass, and T3 transcribed a spoken note locally in about 0.18 s. No physical G2 or R1 was available. Telegram is verified against the real bot: a private forum group with one topic per thread, the full plan, the composed review, and both notes as exact quote-replies on the sentences they change.

**Why glasses.** The moment is hands-free. Ten lines on a 576 × 288 display force a long reply down to what matters.

**Telegram.** Each thread gets a topic in a private group: a header with an agree-all button, the full formatted reply, and your review. Each note is a quote-reply on the exact sentence. "Read on phone" opens that point from a deep link.

**Safety.** Keys stay on the local server. Live mode reads only allowlisted T3 projects. Nothing is sent until you confirm the preview, and Pinpoint never approves shell commands.

Tracks: AI Assistants & Work (main), Messaging & News (second), plus the Best Telegram integration special prize.

## Links for the form

| Field | Value |
|---|---|
| Website | https://pinpoint.qolso.com/ |
| Demo video | https://github.com/sonozaki7/pinpoint/releases/download/v1.0.0/pinpoint-demo.mp4 (published at submission) |
| Source repository | https://github.com/sonozaki7/pinpoint (made public at submission) |
| App package | `apps/glasses/pinpoint.ehpk`, built by `npm --prefix apps/glasses run pack` |
| Tracks | AI Assistants & Work (main), Messaging & News (second) |

## Feature requests (up to five)

Use these titles, or one sentence each, in the form's feature-request field. Full text: [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md).

1. Even Hub SDK: a glanceable alert while the plugin is not focused.
2. Even Hub SDK: highlighting a range inside one text container.
3. Even Hub SDK: a guaranteed input source on long press.
4. Telegram Bot API: topics and links in a bot's private chat.
5. T3 Code: a structured, reviewable reply.

## Eligibility question for Discord

Hi — could you confirm the eligibility of our Heads Up submission, Pinpoint? It is a G2 app that reviews AI-agent work point by point: the core integration is an open-source harness called T3 Code, which runs Claude Code and Codex, and the phone-side companion uses a Telegram bot with topics and quote-replies. We would like to enter the AI Assistants & Work track and the Best Telegram integration prize, and we are happy to adjust the submission if the core integration needs to sit on a different listed app.
