# Connectors: Gmail, Calendar, Notion and OpenRouter

This is the desk integration layer behind the Morning brief. The brief reads
the owner's real inbox, calendar and notes, prepares one-line points on the
glasses, and calls these connectors when the owner double-taps send.

Everything here is plain `fetch`; there is no `googleapis` or Notion SDK
dependency. The only exception is the existing `opencode` CLI, used as the
model fallback when OpenRouter is not configured.

| Connector | What it does | Configuration |
|---|---|---|
| Mail (Gmail) | Lists unread threads matching a query, reads the latest message, sends an in-thread reply, marks the original read | Google OAuth files, `GMAIL_QUERY` |
| Calendar (Google) | Lists events, derives busy blocks, moves an event and keeps its duration | Google OAuth files, `GCAL_CALENDAR` |
| Notes (Notion) | Searches pages and flattens their blocks to text, creates a task row | `NOTION_TOKEN`, `NOTION_TASKS_DB`, `NOTION_NOTES_ROOT` |
| LLM (OpenRouter) | Writes drafts and JSON answers | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |

The interfaces live in `apps/server/src/connectors/types.ts`. `loadConnectors(env,
dataDir)` returns only the integrations that are actually configured. Cloud mode
returns nothing: the public sample workspace has no owner accounts and never
spends model credit.

## Where credentials live

All local-only, all covered by the repository's `.gitignore`:

| File | Contents | Permission |
|---|---|---|
| `apps/server/.data/google-client.json` | The desktop OAuth client JSON downloaded from Google Cloud | owner-only by default |
| `apps/server/.data/google-token.json` | Access token, refresh token, expiry | 0600 |
| `apps/server/.env` | `NOTION_TOKEN`, `NOTION_TASKS_DB`, `NOTION_NOTES_ROOT`, `OPENROUTER_API_KEY` | gitignored |

The server never prints or logs a token, message body, note body or email
address. Connector errors carry an HTTP status and a machine-readable error code
only (for example `HTTP 403 (insufficientPermissions)`), never the response body.

## Google scopes and why

The normal connect request asks for exactly the two data scopes:

- `https://www.googleapis.com/auth/gmail.modify` — read, label, insert demo
  mail, send replies and mark messages read. It does **not** grant permanent
  delete, which is why the full `https://mail.google.com/` scope is avoided.
- `https://www.googleapis.com/auth/calendar.events` — read and edit events on
  the owner's calendars, without calendar sharing, ACL or settings access.

For the hackathon demo, `connect-google --demo` adds two narrow setup scopes,
because Gmail+Calendar cannot fully automate the demo without them:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — lets the
  calendar connector resolve the calendar named "Pinpoint demo". Google does not
  allow `calendarList.list` with `calendar.events`.
- `https://www.googleapis.com/auth/calendar.app.created` — lets the seed script
  create the one secondary calendar owned by this app. Google does not allow
  `calendars.insert` with `calendar.events`, and there is no narrower scope for
  creating a calendar. It grants no access to calendars the app did not create.

The dedicated `freebusy` API endpoint needs `calendar.freebusy` or
`calendar.readonly`. Rather than ask for another scope, `freeBusy()` is
calculated from `events.list` (overlapping events are merged). For the single
demo calendar this is the same answer.

Without `--demo`, the server still reads mail and events; it falls back to the
`GCAL_CALENDAR` id (or primary) because it cannot list calendars, and the seed
cannot create the demo calendar. Re-running with `--demo` is safe.

## Gmail

`listNeedsReply({ query, max })`:

1. `GET /gmail/v1/users/me/threads?q=<query>&maxResults=<max>`.
2. Loads each thread in `format=full` and takes its newest message.
3. Prefers the `text/plain` MIME part (falls back to HTML stripped to text).
4. Removes quoted history: the `On … wrote:` block, Outlook's
   `-----Original Message-----` block, and lines starting with `>`.
5. Returns `EmailThread` with the Gmail thread id, message id, parsed sender,
   `To`, subject, snippet, clean body, received time and a
   `https://mail.google.com/mail/u/0/#all/<threadId>` link.

The default query is `label:pinpoint is:unread`; override it with `GMAIL_QUERY`.
Pinpoint only reads the threads that query returns. It never scans the whole
mailbox, and nothing in this project deletes mail.

`sendReply(...)`:

1. Reads the original `Message-ID` and `References` headers.
2. Builds an RFC 2822 message with `To`, `Subject: Re: …`, `In-Reply-To`,
   `References` and a UTF-8 text body.
3. Encodes the raw message as base64url and calls
   `POST /gmail/v1/users/me/messages/send` with `threadId`, so the reply stays in
   the same conversation.
4. Removes the `UNREAD` label from the original message.
5. Returns the sent message id and the thread link.

If marking the original read fails after a successful send, the send is still
reported as successful. This avoids a retry that would send the same reply twice.

### Demo mail

`scripts/seed-demo.mjs` creates the `pinpoint` label and inserts two unread
messages with `users.messages.insert` (never `send`):

- Priya Shah: Acme contract, net-45 agreed, clause 12 to be narrowed.
- Tomas Berg: podcast recording, "Tuesday 10:00?".

They are sent from plus-addresses of the connected account
(`<account>+priya@…`), so a reply lands back in the same inbox. Running the seed
again checks the label first and does not duplicate them.

## Google Calendar

The calendar connector uses `GCAL_CALENDAR` when set (id or summary). Otherwise
it looks for the calendar whose summary is "Pinpoint demo" and falls back to
`primary`.

- `listEvents({ from, to })` calls `events.list` with `singleEvents=true`,
  `orderBy=startTime`, follows `nextPageToken`, skips cancelled events, and
  returns `htmlLink` as the link.
- `freeBusy({ from, to })` lists events in the window, drops invalid times,
  sorts, and merges overlapping intervals.
- `moveEvent({ calendarId, eventId, start, end })` reads the event, keeps the
  original duration when `end` is empty or invalid, preserves the event's time
  zone, and calls `events.patch` with only the new start/end.

The seed creates a secondary calendar named "Pinpoint demo" with:

| Day | Time | Event |
|---|---|---|
| next Tuesday | 10:00–12:00 | Deep work block (busy when Tomas proposes 10:00) |
| next Wednesday | 08:30–09:30 | Dentist |
| next Wednesday | 09:00–09:30 | 1:1 with Ken (clashes with the dentist) |

The dates are computed for the next Tuesday/Wednesday, so the demo stays
current. Re-running matches summary plus start instant and does not duplicate
events.

## Notion

Pinned to `Notion-Version: 2026-03-11`, the current API version (verified against
the Notion docs). It therefore uses the 2025-09-03 data-source model:

- `NOTION_TASKS_DB` may be either a database id or a data source id.
- For a database id, the connector calls `GET /v1/databases/:id`, takes its
  first data source (preferring one named "Tasks"), then reads the property
  schema from `GET /v1/data_sources/:id`.
- New task pages are created under `{ type: "data_source_id", data_source_id }`.
- The title property is found by schema type `title`; the date property by type
  `date` (preferring a name containing "due", "date" or "deadline"). `details`
  becomes paragraph blocks. If the schema has no date property, the due date is
  prepended to the details text. A source URL is appended as a final paragraph.

`search(query, max)`:

1. `POST /v1/search` with a page filter, sorted by last edited.
2. Keeps non-trashed pages only.
3. Flattens each page's top-level blocks to plain text (`GET
   /v1/blocks/:id/children`, up to 300 blocks), capped at **4,000 characters per
   note**.
4. Preserves the page URL returned by Notion.

Notion's search endpoint matches page **titles**, not body text; the blocks are
flattened after a title match so the brief can quote the note. `NOTION_NOTES_ROOT`
is used to rank the owner's notes page first; Notion has no subtree filter, so
search is workspace-wide within what the integration can see.

`scripts/connect-notion.mjs` finds or creates, under `NOTION_NOTES_ROOT`:

- a "Pinpoint demo" page,
- a "Tasks" database with `Name` (title), `Due date` (date), `Status` (status),
- an "Acme contract" note containing:
  "Acme contract: net-45 agreed with Priya on Nov 12; clause 12 to be narrowed".

It prints the two env lines to paste into `apps/server/.env`. If
`NOTION_NOTES_ROOT` already points at the "Pinpoint demo" page, it reuses it, so
re-running is safe.

## OpenRouter

The model id is `deepseek/deepseek-v4.1-flash`, verified live against
`GET https://openrouter.ai/api/v1/models` (a current, cheap DeepSeek chat model).
Override with `OPENROUTER_MODEL`.

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`.
- Headers: `Authorization: Bearer …`, `HTTP-Referer:
  https://pinpoint.qolso.com`, `X-Title: Pinpoint`.
- 30-second timeout.
- `json: true` sends `response_format: { type: "json_object" }`.
- One retry on HTTP 429 or 5xx, honouring a small `Retry-After`.
- Errors expose only the status and error code; the key and prompt are never
  echoed.

Without `OPENROUTER_API_KEY`, a live server uses the existing opencode CLI path
(`core/splitter/opencode.ts`) with `SPLITTER_MODEL` (default
`opencode-go/deepseek-v4.1-flash`). Demo mode does not spawn opencode; cloud mode
never calls a model.

## Fake connectors (demo and tests)

`createFakeConnectors(seed?)` in `apps/server/src/connectors/fake.ts` is
in-memory and deterministic. It imports no `node:` modules, so a browser
simulator can use it too.

- Default demo instant: Friday 27 November 2026, 08:00 UTC.
- Priya and Tomas emails, the Tuesday/Wednesday clash, and the Acme note.
- Sending a reply removes the thread from "needs reply" and records the exact
  `to`, `subject`, `body`, id and link in `effects.sentReplies`.
- Moving an event updates the in-memory event, keeps its duration when `end` is
  empty, and records it in `effects.movedEvents`.
- Creating a task records it in `effects.createdTasks` and `tasks`.
- `noteHits`, `events`, `threads`, `llmCalls` and `reset()` are exposed for tests
  and the demo UI.

## Morning setup (10 minutes)

### 1. Google (about 5 minutes)

1. Open <https://console.cloud.google.com/projectcreate>. Create a project named
   **Pinpoint** and select it.
2. Open <https://console.cloud.google.com/apis/library>. Search **Gmail API** →
   **Enable**. Go back, search **Google Calendar API** → **Enable**.
3. Open <https://console.cloud.google.com/apis/credentials/consent>. Choose
   **External** → **Create**. App name **Pinpoint**, add your support email.
   Save through the steps. Under **Test users**, add your own Google address.
4. Open <https://console.cloud.google.com/apis/credentials> → **Create
   credentials** → **OAuth client ID** → **Desktop app** → name **Pinpoint
   desktop** → **Create** → **Download JSON**.
5. Move the download to `apps/server/.data/google-client.json`. Create the
   folder if needed.
6. In the repo root run:

   ```bash
   node scripts/connect-google.mjs --demo
   ```

   `--demo` adds two narrow calendar-setup permissions (finding and creating the
   demo calendar). Pick your account, allow the requested permissions, and wait
   for "Google connected". The script prints only counts (Gmail labels,
   calendars).

### 2. Notion (about 3 minutes)

1. Open <https://www.notion.so/my-integrations> → **New integration**. Name it
   **Pinpoint**, pick your workspace, enable **Read content** and **Insert
   content**, then copy the Internal Integration Secret.
2. In Notion create a page named **Pinpoint**. Open it → **…** → **Connections**
   → add **Pinpoint**.
3. Copy the page link. Add to `apps/server/.env`:

   ```dotenv
   NOTION_TOKEN=ntn_...
   NOTION_NOTES_ROOT=<the page link or id>
   ```

4. Run:

   ```bash
   node scripts/connect-notion.mjs
   ```

   Paste the two printed lines (`NOTION_TASKS_DB`, `NOTION_NOTES_ROOT`) into
   `apps/server/.env`.

### 3. Demo data (about 1 minute)

```bash
node scripts/seed-demo.mjs
```

This creates the `pinpoint` label and two unread emails, the "Pinpoint demo"
calendar with the Tuesday/Wednesday clash, and the Acme note if it is missing.
Nothing is sent, deleted or modified outside those demo areas.

### 4. OpenRouter (optional, about 1 minute)

Create a key at <https://openrouter.ai/keys> and add to `apps/server/.env`:

```dotenv
OPENROUTER_API_KEY=sk-or-...
# OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
```

Without a key, live mode falls back to the opencode CLI.

### 5. Start the desk

```dotenv
PINPOINT_MODE=live
T3_PROJECTS=pinpoint
```

```bash
npm --prefix apps/server run dev
```

The Morning brief can now call `loadConnectors(env, env.dataDir)`.

## Checks

```bash
npm --prefix apps/server test
cd apps/server && npx tsc --noEmit -p .
```

The connector tests use mocked `fetch`; they never touch the owner's real
accounts. The OpenRouter model id was verified live against the public models
endpoint.

## Troubleshooting

| Symptom | What it means | Fix |
|---|---|---|
| `google-token.json` has no refresh token | Consent did not return an offline token | Delete the token file and run `connect-google` again; keep `prompt=consent` |
| `Google token refresh returned HTTP 400 (invalid_grant)` | The refresh token was revoked or expired | Run `connect-google` again |
| `calendar returned HTTP 403` while seeding | The token lacks the two narrow setup scopes | Run `node scripts/connect-google.mjs --demo` and allow the calendar setup permissions |
| Gmail returns no threads | The label is empty or the query names a different label | Run `seed-demo`, or set `GMAIL_QUERY` |
| `NOTION_TASKS_DB could not be read` | The id is wrong or the database is not shared with the integration | Run `connect-notion` again and paste the printed id |
| `openrouter returned HTTP 402` | The OpenRouter account has no credit | Add credit or remove `OPENROUTER_API_KEY` to use opencode |
