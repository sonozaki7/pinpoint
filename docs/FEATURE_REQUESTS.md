# API feature requests

Five gaps Pinpoint hit while building the Heads Up demo. Each cost us a design compromise, an extra request, or a setup step a judge would have to repeat. Names are suggestions; the shape is the point.

## 1. Even Hub SDK — a glanceable alert while the plugin is not focused

- **Problem:** a plugin cannot alert the user unless it is focused. The FAQ says plugins get no push notifications, and only the first-party Notifications surface may show alerts, so Pinpoint reached the wearer only through a mirrored Telegram message.
- **Proposal:** a manifest permission `background-alert`, plus `bridge.sendGlanceAlert({ title, body, deepLink })`, rate-limited to one per plugin every few minutes; a tap opens `deepLink`.
- **Benefit:** a waiting plan reaches the wearer hands-free, beside other notifications, without taking over whatever app is open.
- **Source:** Even Hub FAQ ("Can I receive push notifications? No.") and research note `03-even-g2-platform-and-hub-apps.md` §(e) 2–4.

## 2. Even Hub SDK — highlighting a range inside one text container

- **Problem:** brightness is per container, so the quote pane cannot mark the cited sentence inside a paragraph. The alternatives are one container per sentence (over the 8-container page limit) or a full rebuild that flashes.
- **Proposal:** `textContainerUpgrade` with `ranges: [{ start, length, emphasis: "invert" | "bright" | "dim" }]`, plus `scrollToRange(containerID, start)`; unlisted ranges keep the existing `textColor`.
- **Benefit:** the citation stays visible inside its paragraph, with fewer containers, fewer rebuilds, and a layout that does not jump while swiping.
- **Source:** Even Hub Display docs (per-container `textColor`, 8 text containers per page); research note `06-interaction-feasibility.md` Q1–Q2.

## 3. Even Hub SDK — a guaranteed input source on long press

- **Problem:** the long-press docs say `eventSource` is absent on `LONG_PRESS` and `LONG_PRESS_RELEASE`; the SDK type says it identifies the ring, right temple, or left temple. Pinpoint cannot safely give the ring its own hold gesture.
- **Proposal:** guarantee `eventSource` on both long-press events, document the enum once, and add `source: "ring" | "right" | "left"` to the simulator's `/api/input`.
- **Benefit:** apps can split one gesture set across ring and temple predictably, and test the difference without hardware.
- **Source:** Even Hub Device API long-press section vs the SDK `Sys_ItemEvent.eventSource` comment; research note `06-interaction-feasibility.md` Q7 and Q9.

## 4. Telegram Bot API — topics and links in a bot's private chat

- **Problem:** to give each agent thread a topic and a tappable link, we had to create a supergroup, enable Topics, make the bot an admin with Manage Topics, and find the `-100…` id. `direct_messages_topic_id` appears on send methods; there is no documented create or list call, and bot-DM messages have no `t.me` link.
- **Proposal:** `createDirectMessageTopic`, `getDirectMessageTopics`, and a `message_link` on send responses when the destination is a DM topic.
- **Benefit:** one-tap setup, no group or admin rights, and links that open the exact message, which is what makes a personal bot installable.
- **Source:** `docs/telegram-setup.md` steps 1–3 and "Limits and safety notes"; Telegram Bot API (`direct_messages_topic_id`); research notes `06-interaction-feasibility.md` Q10 and `02-telegram-features.md` §10.

## 5. T3 Code — a structured, reviewable reply

- **Problem:** on 0.1.11 shell rows always return `latestVisibleMessage: null`, so each report candidate costs an extra transcript request. Plans are markdown with no item ids, and feedback goes back as plain text, so "item 4" exists only inside our own deck.
- **Proposal:** a `reviewable` projection per thread, `{ sourceMessageId, planId?, items: [{ id, kind, text, quoteStart, quoteEnd }] }`, plus a `plan.review` command that takes per-item verdicts and notes, and fill `latestVisibleMessage` on shell rows.
- **Benefit:** one request instead of two, citations that survive a re-render, and one item identity shared by the glasses, the phone, and the web.
- **Source:** `docs/t3-api-notes.md` §2 (null `latestVisibleMessage`) and §4 (no approve-plan command; feedback is `message.dispatch`).
