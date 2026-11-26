# Connectors: Gmail drafts and Notion review pages

This is the integration layer behind Pinpoint's two extra review sources. A
review source hands Pinpoint work that is already waiting for a human:

| Source | What Pinpoint reads | Where a note lands |
|---|---|---|
| Gmail drafts | A draft an agent already wrote, under `GMAIL_DRAFTS_QUERY` | The sentence is edited in place; send sends that draft |
| Notion pages | Rows in `NOTION_REVIEW_DB` whose status is `Needs review` | A comment on the exact block, then the page status changes |

T3 Code is the third source and uses its own client (`src/t3`). Pinpoint never
composes an email or a page from nothing.

Everything here is plain `fetch`; there is no `googleapis` or Notion SDK
dependency. Notion page decks reuse the existing splitter (which may call the
opencode CLI), and the only extra model use is a one-sentence rewrite when the
deterministic edit rules cannot express a note.

## Where credentials live

All local-only, all covered by the repository's `.gitignore`:

| File | Contents | Permission |
|---|---|---|
| `apps/server/.data/google-client.json` | Desktop OAuth client JSON downloaded from Google Cloud | owner-only by default |
| `apps/server/.data/google-token.json` | Access token, refresh token, expiry | 0600 |
| `apps/server/.env` | `NOTION_TOKEN`, `NOTION_REVIEW_DB`, `NOTION_NOTES_ROOT`, `NOTION_STATUS_PROP` | gitignored |

The server never prints or logs a token, message body, draft sentence or note
body. Connector errors carry an HTTP status and a machine-readable error code
only (for example `HTTP 403 (insufficientPermissions)`), never the response body.

## Google scope

The consent request asks for exactly one scope:

- `https://www.googleapis.com/auth/gmail.modify` — read, label, update drafts,
  send a draft and mark mail read. It does not grant permanent delete.

There is no calendar scope. Pinpoint has no calendar connector and never asks
for calendar access.

## Gmail drafts

`listDrafts({ query, max })`:

1. `GET /gmail/v1/users/me/drafts?q=<query>&maxResults=<max>`. The default query
   is `label:pinpoint` (`GMAIL_DRAFTS_QUERY`).
2. Loads each draft in `format=full`.
3. Prefers the `text/plain` part (HTML is stripped to text if needed).
4. Returns the draft id (not the message id), message id, thread id, `To`,
   recipient first name, subject, body, update time and a
   `https://mail.google.com/mail/u/0/#drafts/<id>` link.

`getDraft(id)` reads one draft the same way, for a fresh body before editing.

`updateDraft(id, body)` keeps the recipient, Cc/Bcc, subject and thread, builds
an RFC 2822 plain-text message and calls `PUT /gmail/v1/users/me/drafts/:id`
with the base64url `raw` message.

`sendDraft(id)` calls `POST /gmail/v1/users/me/drafts/send` with that id and
returns the sent message id, thread id and the thread link. Sending is the last
step: the draft is not regenerated.

### One point per sentence

A draft body is split with the runtime sentence segmenter. Each sentence with
at least ten characters becomes one `draft` point:

- `glance` is the sentence clipped to 44 ASCII characters;
- `quote` is the exact sentence, so an edit can replace it in place;
- greetings ("Hi Priya,") and a lone sign-off name are left out, never edited.

No model is called to build the deck.

### Edits

`POST /api/edit/:threadId { pointId, text }` applies one spoken note to one
sentence. Deterministic rules run first:

| Note | Result | Method |
|---|---|---|
| `Net-45, not net-60.` | the old phrase is swapped inside the sentence, keeping its casing | `replace` |
| `delete` / `remove this` / `drop it` | the sentence is removed from the draft | `delete` |
| `say we can invoice from Tuesday` / `instead …` / `change it to …` | the sentence is replaced with the dictated words, tidied | `say` |
| anything else | one LLM rewrite of that sentence only, verified to be one sentence | `rewrite` |

The result is saved on the note as `after` (an empty string means deleted), and
the glasses show it immediately. A failed rewrite returns
`error: "Couldn't change this line"` and changes nothing. The deterministic path
takes well under 300 ms and is the only path in the cloud sample.

On send, every saved `after` is applied to the current draft body in point
order; the draft is updated only if something changed, then sent. The receipt is
`Sent to Priya` with the Gmail thread link.

### Flags

A sentence that mentions a number, amount or commitment is compared with linked
notes found through Notion search (recipient + subject). If a note disagrees,
the point gets a short evidence flag, for example `notes say net-45` when the
draft says net-60. No linked note or no conflict means no flag.

## Notion review pages

`NOTION_REVIEW_DB` names the database that holds pages waiting for review. It may
be a database id or a data source id; `NOTION_STATUS_PROP` (default `Status`)
names its status (or select) property. The API is pinned to
`Notion-Version: 2026-03-11`, so the 2025-09-03 data-source model applies.

`listReviewPages()`:

1. Resolves the database or data source and reads its property schema.
2. Queries `POST /v1/data_sources/:id/query` with
   `filter: { property: Status, status: { equals: "Needs review" } }`
   (or the `select` form when the property is a select).
3. Returns live (non-trashed) pages with id, URL, title and last-edited time.

`getReviewPage(pageId)` reads the page and flattens its blocks in document order,
recursing up to three levels. Every line keeps its **block id**, which is what
makes a point's feedback land on the exact paragraph.

`commentOnBlock(blockId, text)` calls `POST /v1/comments` with
`parent: { block_id }`. Some workspaces reject block parents; the source then
posts one page comment that quotes the sentence:
`"<sentence>" — Change: <note> — via Pinpoint (G2)`.

`setReviewStatus(pageId, status)` calls `PATCH /v1/pages/:id` with the status
property. Sending a review sets:

- `Changes requested` when it has at least one note;
- `Approved` when it has none.

Each note becomes one comment on its block (`Change: …` for an objection,
`Note: …` otherwise) with ` — via Pinpoint (G2)` at the end. The receipt shows
`1 comment on Launch post` and `Status: Changes requested`, with the page link.

### Flags and anchors

The deck builder maps each point's quote to the block that contains it and stores
the block id in `Point.anchor`. This is server-side only: the glasses never need
it. A sweeping claim in a page ("every customer", "today", a price) may get the
flag `check this`; no claim pattern means no flag.

## Fakes and tests

Connector tests use a mocked `fetch`; they never touch the owner's accounts. The
cloud sample workspace uses fixture files instead of connectors, and its receipts
end in `(sample)` so nothing looks real. Demo mode has fixture-backed Notion and
Gmail sources that log what would have happened; they never call an API.

## Setup (about 8 minutes)

### 1. Google (about 5 minutes)

1. Open <https://console.cloud.google.com/projectcreate>. Create a project named
   **Pinpoint** and select it.
2. Open <https://console.cloud.google.com/apis/library>. Search **Gmail API** →
   **Enable**. Calendar is not needed.
3. Open <https://console.cloud.google.com/apis/credentials/consent>. Choose
   **External** → **Create**. App name **Pinpoint**, add your support email.
   Under **Test users**, add your own Google address.
4. Open <https://console.cloud.google.com/apis/credentials> → **Create
   credentials** → **OAuth client ID** → **Desktop app** → name **Pinpoint
   desktop** → **Create** → **Download JSON**.
5. Move the download to `apps/server/.data/google-client.json`.
6. In the repo root run:

   ```bash
   node scripts/connect-google.mjs
   ```

   Pick your account, allow Gmail access, and wait for "Google connected". The
   script prints only counts (labels, drafts).

### 2. Notion (about 3 minutes)

1. Open <https://www.notion.so/my-integrations> → **New integration**. Name it
   **Pinpoint**, enable **Read content** and **Insert content**, then copy the
   Internal Integration Secret.
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

   Paste the two printed lines (`NOTION_REVIEW_DB`, `NOTION_NOTES_ROOT`) into
   `apps/server/.env`. The script creates the **Pinpoint demo** page, a **Docs**
   database with `Name` and `Status` (`Needs review`, `Changes requested`,
   `Approved`), and an **Acme contract** note recording net-45.

### 3. Demo data (about 1 minute)

```bash
node scripts/seed-demo.mjs
```

This creates the `pinpoint` label, Priya's email and the agent's draft reply
(with the deliberate net-60 mistake), and the launch-post page in the Docs
database, waiting for review. Nothing is sent or deleted, and re-running it does
not duplicate anything.

### 4. Start the desk

```dotenv
PINPOINT_MODE=live
T3_PROJECTS=pinpoint
```

```bash
npm --prefix apps/server run dev
```

The inbox now merges T3 threads, Notion review pages (`notion:<pageId>`) and
Gmail drafts (`gmail:<draftId>`).

## Checks

```bash
npm --prefix apps/server test
cd apps/server && npx tsc --noEmit -p .
node demo/scripts/verify-fixtures.mjs
```

## Troubleshooting

| Symptom | What it means | Fix |
|---|---|---|
| `google-token.json` has no refresh token | Consent did not return an offline token | Delete the token file and run `connect-google` again; keep `prompt=consent` |
| `Google token refresh returned HTTP 400 (invalid_grant)` | The refresh token was revoked or expired | Run `connect-google` again |
| No drafts in the inbox | The label is empty or `GMAIL_DRAFTS_QUERY` names something else | Run `seed-demo`, or change the query |
| `NOTION_REVIEW_DB is not set` in the log | The live server started before the database id was added | Run `connect-notion`, add the line, restart |
| `NOTION_REVIEW_DB could not be read` | The id is wrong or the database is not shared with the integration | Run `connect-notion` again and paste the printed id |
| Notion comment on the page instead of the block | The workspace rejects block-parent comments | Expected fallback: the comment quotes the sentence |
| `Status: …` receipt line has `ok: false` | The status option is missing from the database | Add `Needs review`, `Changes requested`, `Approved` to the status property |
