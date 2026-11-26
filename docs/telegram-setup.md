# Telegram setup (5–10 minutes)

Pinpoint uses one private Telegram group with **Topics** on as its "desk". Each agent
task (a plan, a question, a report, a failed run) gets its own topic named after the
thread. The topic list shows the state at a glance:

- ❗️ **needs you** — the agent is waiting for a review or an answer
- ✅ **reviewed or agreed** — nothing is waiting
- ‼️ **failed** — the run stopped with an error

Telegram's built-in topic-icon list has no yellow circle or warning triangle, so ❗️ and
‼️ stand in. If a bot ever cannot set a custom icon, the name is prefixed with
🟡 / ✅ / ⚠️ instead (the module remembers that and keeps using prefixes).

Inside each topic:

1. **The card**, first message, the only message that notifies when the agent needs you:

   ```
   🟡 Needs you: plan, 7 steps
   login-fix · acme-shop

   1. Reproduce the bug with two open tabs
   2. Add a test that fails on the bug
   ...
   4. ⚠️ Sign out every customer once
   ...
   Review it on your G2, or:
   ```

   Buttons: **✅ Agree all** and **📄 Read full plan** (a link to the full text
   message). A question card also shows its options as buttons when the server wires
   the answer hook (see the team section).
2. **The full agent text**, silent (no notification), rendered quote-safe. Texts longer
   than about 600 characters collapse into one expandable block on the phone.
3. **When you send a review from the glasses**, everything is silent:
   - one quote-reply per note on the exact sentence, body only, for example
     `❌ Your change: Don't sign everyone out. Just fix the broken logins.`,
     `📝 Your note: ...`, `💬 Your answer: ...`;
   - one summary, for example
     `✅ Sent to the agent from your G2: 1 change, 6 agreed`;
   - the card's first line becomes `✅ Reviewed from G2: 1 change sent`, its buttons
     are removed, and the topic icon turns ✅.
4. **Read on phone** from the glasses posts one message that notifies:
   `📖 Step 4: you opened this from your glasses`, as a quote-reply on the sentence,
   followed by the whole paragraph that contains that sentence.

The first topic in the group is **General**. It holds one pinned legend:

```
How Pinpoint Desk works: each agent task gets a topic.
❗️ needs you · ✅ reviewed · ‼️ failed.
Review on your G2 (scroll with the ring, tap to talk, double-tap to send) or tap ✅ Agree all here.
Your notes appear attached to the exact sentences.
```

Without a token the server runs in **dry-run**: it writes every intended Telegram call to
`apps/server/.data/telegram-dryrun.log` and returns fake links, so tests and the demo work
without a bot.

---

## 1. Create the bot with @BotFather

@BotFather is Telegram's official bot that creates and configures other bots.

1. In Telegram, search for **@BotFather** (blue check mark) and open it.
2. Send `/newbot`.
3. Give it a display name, for example `Pinpoint Desk`.
4. Give it a username that ends in `bot`, for example `pinpoint_desk_bot`.
5. BotFather replies with a message containing a token that looks like
   `8123456789:AAH...`.

**That token is a password.** Anyone who has it controls the bot. Do not paste it into
chat, a screenshot, a commit, or a support request. It belongs in exactly one place:
`apps/server/.env` on your machine (that file is ignored by Git).

If a token ever leaks, send `/revoke` to @BotFather and use the new one.

## 2. Create a private group and turn on Topics

Topics (forum mode) is what gives each task a separate conversation inside one group.

1. Telegram → **New Group** → name it `Pinpoint Desk`.
   A new group needs at least one other member; pick any contact, then remove them after
   the group is created (Telegram keeps groups that contain you and bots).
2. Open the group → tap the group name → **Edit** → turn on **Topics**.
   Turning Topics on converts the group to a supergroup. That is expected and required.
3. Add the bot as an administrator:
   group name → **Administrators** → **Add Administrator** → search `@pinpoint_desk_bot`
   → enable **Manage Topics** (leave the other permissions at their defaults) → save.

The "Manage Topics" right is what allows the bot to create topics and set their icons.
Without it, topic creation fails with `not enough rights to create a forum topic`.

## 3. Find the group's chat id

The bot needs the group id (a number starting with `-100`), not the group name.

1. Post any message in the group, for example `hello`.
2. On the machine that runs the server, run this in a terminal (replace `<TOKEN>` with the
   token from step 1; keep the quotes):

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
   ```

3. In the output, find the entry whose `chat` has your group's title, for example:

   ```json
   "chat": {
     "id": -1001234567890123,
     "title": "Pinpoint Desk",
     "type": "supergroup",
     "is_forum": true
   }
   ```

4. Copy the whole `id`, including the leading minus sign.
   If `is_forum` is `false`, Topics are not enabled — go back to step 2.

Common reasons the output is empty:

- No message has been posted in the group since the bot was added. Post one and retry.
- A webhook is set on the bot. Long polling and webhooks are mutually exclusive; run
  `curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"` and retry.

## 4. Put both values in `.env`

In `apps/server`, copy the example file if you have not already:

```bash
cd apps/server
cp .env.example .env
```

Edit `.env` and fill in:

```dotenv
TELEGRAM_BOT_TOKEN=8123456789:AAH...
TELEGRAM_CHAT_ID=-1001234567890123
```

`.env` is listed in `.gitignore`; never commit it. Restart the server afterwards.

## 5. Check that it works

1. Start the server (`npm run dev` in `apps/server`).
2. `GET /api/health` should report Telegram as `ok` (it reports `dry-run` when the token
   is empty, and `error` if a call fails).
3. On the first start the bot posts and pins the legend in **General**.
4. Trigger a thread so it enters the inbox. In Telegram you should see:
   - a new topic named after the thread, with the ❗️ icon;
   - the card `🟡 Needs you: plan, 7 steps` with **✅ Agree all** and
     **📄 Read full plan**;
   - the full agent text below it, silent and collapsed when long.
5. Tap **✅ Agree all**: the buttons disappear, the card becomes
   `✅ Agreed from Telegram`, and the review is sent to T3.
6. Send a review from the glasses. Each note appears as a silent quote-reply under the
   sentence it refers to, followed by the summary, and the card becomes
   `✅ Reviewed from G2: 1 change sent`.
7. Use **Read on phone** in the glasses menu. It posts a notifying
   `📖 Step 4: you opened this from your glasses` reply with the whole step paragraph and
   opens a link like `https://t.me/c/1234567890123/57?thread=42` (42 is the topic, 57 the
   message).

The mapping between threads, topics and message ids is stored in
`apps/server/.data/telegram.json`. Deleting that file (and optionally the topics in
Telegram) resets the integration; nothing else is persisted.

## 6. Dry-run (no bot needed)

Leave `TELEGRAM_BOT_TOKEN` empty. Every call the module would make is appended as one JSON
line to `apps/server/.data/telegram-dryrun.log`:

```json
{"at":"2026-11-24T01:00:00.000Z","method":"sendMessage","params":{"chat_id":"-1001234567890","text":"How Pinpoint Desk works: ...","disable_notification":true}}
{"at":"2026-11-24T01:00:00.100Z","method":"pinChatMessage","params":{"chat_id":"-1001234567890","message_id":1000,"disable_notification":true}}
{"at":"2026-11-24T01:00:00.200Z","method":"getForumTopicIconStickers","params":{}}
{"at":"2026-11-24T01:00:00.300Z","method":"createForumTopic","params":{"chat_id":"-1001234567890","name":"auth-refresh-fix","icon_custom_emoji_id":"..."}}
{"at":"2026-11-24T01:00:00.400Z","method":"sendMessage","params":{"chat_id":"-1001234567890","message_thread_id":1001,"text":"🟡 Needs you: plan, 7 points\n...","reply_markup":{"inline_keyboard":[[{"text":"✅ Agree all","callback_data":"agree:thread-abc"}]]}}}
```

Links returned in dry-run look real (`https://t.me/c/1234567890/1001?thread=1000`) but do
not open anything. This is also how the automated tests run.

`scripts/telegram-verify.mjs` runs both plain-language fixtures through the real notifier.

```bash
# no network
npx tsx scripts/telegram-verify.mjs --dry-run

# live group (needs token and chat id)
npx tsx --env-file=apps/server/.env scripts/telegram-verify.mjs
```

The live run first removes the earlier Pinpoint test topics (`auth-refresh-fix`,
`login-fix`, `payment-upgrade`) from the group, posts the legend once, then rebuilds both
topics and prints a link for every message. `--data-dir <path>` uses a separate store and
builds nothing on top of the server's real one.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `400 Bad Request: chat not found` | Wrong chat id, or the bot is not in the group | Copy the id from `getUpdates` again, including the leading `-100`; make sure the bot is a member |
| `400 Bad Request: not enough rights to create a forum topic` | Bot is not an administrator, or lacks **Manage Topics** | Group → Administrators → bot → enable Manage Topics |
| `400 Bad Request: the chat is not a forum` | Topics are off | Group settings → Edit → Topics → on |
| `401 Unauthorized` | Token is wrong, revoked, or has stray spaces | Regenerate with @BotFather `/token` (or `/revoke`) and update `.env` |
| `429 Too Many Requests: retry after N` | More than about one message per second in the chat | Handled automatically (waits `N` seconds and retries); repeated 429s mean something is sending in a burst |
| `400 Bad Request: QUOTE_TEXT_INVALID` | The quote is no longer an exact substring of the source message | Handled automatically by falling back to a plain reply; if frequent, the deck's quotes drifted from the source (splitter quote check) |
| Topic names start with 🟡 / ✅ / ⚠️ | Telegram refused a custom topic icon | Expected fallback; the module stopped trying icons for this process. Restart to retry |
| No "Agree all" buttons | The card was already reviewed, or the message was edited by hand | Send a new attention message; the card is rebuilt on the next agent message |
| Button spins forever | The server is not polling callbacks, or the review could not be sent to T3 | Confirm the server started the notifier (`start()`); check the server log for `onAgreeAll failed` |
| Nothing appears in Telegram | Token empty (dry-run), or bot not restarted after editing `.env` | Check `/api/health`; restart the server |

## Limits and safety notes

- **One bot, one poller.** Starting the server switches the bot to long polling (grammY
  removes any webhook). Do not run two servers with the same token — Telegram gives each
  update to only one of them.
- **Rate limit.** The module sends at most one message per second per chat and retries
  `429` responses using Telegram's `retry_after`.
- **Quotes must be exact.** A quote-reply only works when the quoted text is an exact
  substring of the target message. The module maps each quote to the split part that
  contains it and falls back to a plain reply when Telegram refuses. The fallback is
  reported through the `onQuoteFallback` hook (and a server warning).
- **Notifications.** Only the card and the read-on-phone message notify. The full text,
  every review note, the summary and the legend are silent (`disable_notification`).
- **Threads live in memory of the group.** The bot cannot read older chats or messages it
  did not receive; everything it needs is in the topics it created and in
  `.data/telegram.json`.
- **Secrets.** The token is only read from `TELEGRAM_BOT_TOKEN` and only appears in the
  request URL to Telegram. It is never written to the dry-run log, errors, or Git.
- **Shutdown.** Call `notifier.stop()` from the server's shutdown handler so long polling
  releases the process (it is otherwise kept alive by the open connection). `start()`
  validates the token first, so a bad token makes the health check report Telegram as
  `error` instead of pretending to be live.

## For the team (how the server uses it)

`apps/server/src/telegram/index.ts` exports `createTelegramNotifier(env, { onAgreeAll })`,
which returns `{ mode, onAttention, onReviewSent, readOnPhone, start, stop }`:

```ts
const telegram = createTelegramNotifier(env, {
  onAgreeAll: (threadId) => t3.sendReview(threadId, '✓ Reviewed on phone: all points agreed. Continue.'),
  // Optional: makes question cards show option buttons. Wire it to the same path the
  // glasses use: save an answer note, then send the review.
  onAnswer: async (threadId, pointId, option) => {
    // Persist the answer through the review store, then service.send(threadId).
    console.log(`answer ${threadId}/${pointId}: ${option}`);
  },
});

await telegram.start(); // posts/pins the legend once, then long-polls the buttons
await telegram.onAttention(thread, { sourceMessageId, text }, deck);
const { link, messages } = await telegram.onReviewSent(thread, deck, draft, composedMessage);
// messages: one entry per card/note/summary with its deep link
await telegram.readOnPhone(thread, deck, point);
```

- `onReviewSent` returns `{ link, messages }`: `link` points at the summary; `messages`
  lists the card, one entry per note (with `pointId`) and the summary.
- `readOnPhone` returns `{ link, messageId }`.
- `onQuoteFallback` receives `{ quote, text, reason }` whenever Telegram refuses a quote.
- Everything is escaped before it reaches Telegram's HTML parser; long text collapses into
  an expandable blockquote, code fences become `<pre><code>`, markdown tables are sent
  monospaced, and messages never exceed Telegram's 4096-character limit.
- The module also accepts the server's parsed config object directly, so the loader can
  pass `env` unchanged: it reads `telegramToken` / `TELEGRAM_BOT_TOKEN`,
  `telegramChatId` / `TELEGRAM_CHAT_ID`, and `dataDir` (`PINPOINT_DATA_DIR`).

**Wiring.** The agree-all hook receives the **thread id string**
(`onAgreeAll(threadId)`). The server's `AgreeAllHook` accepts either the id or the thread
object and resolves the id itself, so the existing wiring needs no adapter:

```ts
const { notifier } = await loadTelegramNotifier(env, {
  onAgreeAll: async (threadOrId) => {
    const thread =
      typeof threadOrId === 'string' ? await inbox.lookupThread(threadOrId) : threadOrId;
    if (thread) await service.agreeAll(thread);
  },
});
```
