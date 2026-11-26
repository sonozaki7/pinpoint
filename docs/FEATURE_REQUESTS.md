# API feature requests

Five gaps Pinpoint hit while building for Even G2 and R1. Each one cost a design compromise, an extra moving part, or a setup step a judge or a user has to repeat. Names are suggestions; the shape is the point.

Every claim below is checked against [device-readiness.md](device-readiness.md), [host-qa-notes.md](host-qa-notes.md) and Even's public docs as read on Nov 26–27 2026. Nothing was tested on hardware (no G2 or R1 was available), so the platform behaviour described is **as documented**, and each request says so where it matters.

## 1. Even Hub SDK: a glanceable alert while the plugin is not focused

- **Problem:** Pinpoint's whole job is telling you when an agent needs you. A plugin cannot do that unless it is open: the Hub FAQ says plugins get no push notifications ("Can I receive push notifications? No."), and only the first-party notifications surface can alert. We route the alert through a Telegram message that the glasses mirror, which means a second app and a bot setup for something the platform should offer.
- **Proposal:** a manifest permission `background-alert`, plus `bridge.sendGlanceAlert({ title, body, deepLink })`, rate limited to a few per hour per plugin, and a tap opens `deepLink` inside the plugin.
- **Benefit:** an agent that needs a decision reaches the wearer hands-free, beside other notifications, without taking over the app that is open. Every "watch for something" app (agents, inboxes, monitoring) needs it.
- **Evidence:** Even Hub FAQ; [device-readiness.md](device-readiness.md) §5 (WebView suspends with the phone, audio and sockets stop) and [host-qa-notes.md](host-qa-notes.md) ("the OS may still kill it").

## 2. Even Hub / Even app: an on-device or hosted AI API (speech-to-text first)

- **Problem:** the mic delivers raw PCM and the host says to bring your own speech-to-text. Pinpoint therefore runs Whisper on its own server (and on the user's computer when paired), pays for it, and has to explain to users that their voice leaves the phone. Every voice app on the platform repeats this, and the upload plus transcription round trip (about 1.8 s for a short note on our cloud) is the slowest step of a correction.
- **Proposal:** `bridge.transcribe({ language })` returning text from a platform STT (on-device if possible), and, later, a small hosted model call for classification and short answers, both permission-gated and quota-limited per user.
- **Benefit:** faster corrections (no upload), no per-developer ASR bill, one privacy story the user already accepted when they bought the glasses, and developers can ship without running a server at all.
- **Evidence:** [host-qa-notes.md](host-qa-notes.md) ("Bring your own STT (Deepgram suggested)"), [device-readiness.md](device-readiness.md) §4 (PCM 16 kHz only; no chunk size promised).

## 3. Even Hub SDK: a guaranteed input source in every event, ring versus temple

- **Problem:** the docs say `eventSource` is absent on `LONG_PRESS` and `LONG_PRESS_RELEASE`, while the SDK type says it identifies ring, right temple or left temple. The simulator also does not show the difference. Pinpoint wants "ring for where, temple for menu", and cannot rely on it. The docs also disagree on whether a tap arrives on `sysEvent` or `textEvent` on hardware, so a handler that guesses wrong is silently dead.
- **Proposal:** always set `eventSource` on every input event, document the enum once, and add `source: "ring" | "right" | "left"` to the simulator's input API.
- **Benefit:** apps can split one gesture set between ring and temple, and test it without hardware.
- **Evidence:** [device-readiness.md](device-readiness.md) §3.1–3.3 (event envelopes, long press, simulator versus hardware). **Unverified on hardware.**

## 4. Even Hub SDK: rich text and range emphasis in a text container

- **Problem:** brightness is per container (`textColor` 0–4), a page holds at most 8 text containers, and one font is available. To mark "this is the sentence the answer comes from" inside a paragraph, we need one container per sentence or a full rebuild that flashes. Pinpoint's review page already sits at exactly 8 containers, so it cannot grow.
- **Proposal:** `textContainerUpgrade` with `ranges: [{ start, length, emphasis: "invert" | "bright" | "dim" }]`, plus `scrollToRange(containerID, start)`. A bold weight or a larger size for one line would also remove a dependence on drawing symbols.
- **Benefit:** the cited sentence stays visible in its paragraph, with fewer containers, no rebuild flicker (≈165 ms each) and a layout that does not jump while the user swipes.
- **Evidence:** [device-readiness.md](device-readiness.md) §6.5 (container budget, rebuild versus upgrade timings, brightness range); Even Display docs.

## 5. Even Hub: a shareable beta or private install link, and a published review time

- **Problem:** the only way a judge or a user gets an unreleased app onto their glasses is either (a) a QR sideload that stops when the phone locks, or (b) the beta tester list, which needs the tester's Even account email, an invitation they accept within 7 days, and the account flipped to developer mode in the web hub, then an app force-quit. Store review has no published turnaround. For a hackathon with a judging window of days, "install this" is the hardest step of the whole product.
- **Proposal:** a developer-created private install link (revocable, N installs) that survives phone lock like a beta build, a tester self-join by code instead of email, and a stated review time with a status API for submissions.
- **Benefit:** judges, teammates and early users can run an app from a link in a minute, and developers can plan around review.
- **Evidence:** [device-readiness.md](device-readiness.md) §2.1–2.3 (testing modes table, account requirements, "the docs publish no turnaround time").

---

## Also hit, not submitted

These are real gaps but not on Even's platform, so they are not in the five.

- **Telegram Bot API: topics and message links in a bot's private chat.** Giving each task a topic needed a supergroup, Topics enabled, the bot as admin with Manage Topics, and a `-100…` chat id ([telegram-setup.md](telegram-setup.md)). Bot DMs have `direct_messages_topic_id` on send methods, but no documented create or list call and no `t.me` link.
- **T3 Code: a structured, reviewable reply.** Shell rows return `latestVisibleMessage: null` on 0.1.11, plans are markdown without item ids, and feedback goes back as plain text ([t3-api-notes.md](t3-api-notes.md) §2 and §4). A `reviewable` projection with item ids would let "step 4" survive a re-render.
