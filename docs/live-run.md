# Pinpoint live run — 2026-11-24

Hardened and verified `apps/server` against the real local T3 Code server
(0.1.11, orchestration protocol 2) on this Mac. No commits were made and no
token appears in this file.

## 1. Privacy allowlist (new)

The owner's T3 Code holds threads from many private projects. Pinpoint now
only ever reads the projects named in `T3_PROJECTS` (comma-separated project
ids or exact titles). The filter is applied inside the T3 client, before
attention rules, transcript reads, deck builds and Telegram alerts. Single
thread reads (deck, review, send, phone, answers) hit the same gate, so a
guessed thread id from another project returns 404 and never loads its text.

- `apps/server/.env` (gitignored): `T3_PROJECTS=pinpoint`
- `.env.example` documents the line.
- Live mode with an empty allowlist refuses to start.

```sh
$ T3_PROJECTS='' PINPOINT_MODE=live npm start
[pinpoint] failed to start: Refusing to start in live mode: T3_PROJECTS is empty.
Set T3_PROJECTS to a comma-separated list of T3 project ids or exact project
titles (for example T3_PROJECTS=pinpoint) so Pinpoint only reads the projects
you allow.
```

Live check with a real thread from another (private) project (id partially masked):

```
GET  /api/deck/<private thread>   -> 404 {"error":"Unknown thread","code":"not_found"}
PUT  /api/review/<private thread> -> 404
POST /api/review/<private thread>/send -> 404
server log lines mentioning that thread or its project: none
```

`GET /api/inbox` returned 6 threads, all `"project": "pinpoint"`, while the
same T3 shell exposes 45 threads across several private projects and `pinpoint`.

Tests: `test/privacy.test.ts` (8 cases) plus updated client tests.

## 2. Starting in live mode

```sh
cd apps/server
PINPOINT_MODE=live SPLITTER_PROVIDER=opencode npm start
```

Observed first line:

```
[pinpoint] listening on http://127.0.0.1:8787 mode=live
splitter=opencode:deepseek-v4.1-flash telegram=dry-run
```

`GET /api/health`:

```json
{"ok":true,"mode":"live","t3":"ok","telegram":"dry-run","splitter":"opencode:deepseek-v4.1-flash"}
```

Telegram ran in dry-run (no bot token); every intended Bot API call was logged
to `.data/telegram-dryrun.log` and fake links were returned.

## 3. End-to-end: report thread

Created a fresh sandbox thread:

```sh
~/.t3/bin/t3 thread start /Users/so/Desktop/Project/pinpoint \
  "Review this release checklist in exactly 5 numbered points …" \
  --provider opencode --model opencode-go/deepseek-v4.1-flash \
  --title "Pinpoint live: release checklist review" --wait
```

`GET /api/inbox` (trimmed):

```json
{"threadId":"mcp:3d56f690-…","title":"Pinpoint live: release checklist review",
 "project":"pinpoint","attention":"report","summary":"5 points","deckReady":true,
 "pointCount":5,"draftNotes":0}
```

`GET /api/deck/mcp:3d56f690-…`: 5 points, built by
`opencode:deepseek-v4.1-flash` in **13.1 s**. Headline
"Five release gates before going live". Example point:

```
3. [step] Move deploy off Friday 5pm
   "Deploying Friday at 5pm puts the release live as staff leave for the
    weekend, so move it to early in a working day when people are around to watch it."
```

Quote verification (server-side verifier, independent re-check against the T3
transcript): **5/5 exact substrings**, 0 normalized fixes, 0 dropped. Every
deck produced during this run had 100% exact quotes (30/30 across 6 decks).

Review round trip:

```sh
PUT  /api/review/<id>            # objection on point 3, note on point 5
POST /api/review/<id>/preview    # composed message
POST /api/review/<id>/send       # 200 in ~70 ms
```

Preview:

```
Review from G2 (Pinpoint) — 5 points
✗ 3. "Deploying Friday at 5pm puts the release live as staff leave for the weekend,
      so move it to early in a working day when people are around…" → No, keep the
      Friday deploy but put an on-call engineer on it.
● 5. "Telling customers only after deploy gives them no warning…" → Add a status
      page update to the announcement.
✓ Agreed: 1, 2, 4. Continue.
```

`t3 thread show` confirmed the cited review arrived as a user message and the
agent replied. The thread then re-entered the inbox as a **new report**, with a
fresh deck built from the new reply.

## 4. End-to-end: question thread

Created with `claudeAgent/claude-sonnet-5-5`; the agent asked one
multiple-choice question and waited. Inbox showed `question`; deck: 1 point,
9.0 s: quote "Which port should the health endpoint use?", options
`Same as API port`, `Separate dedicated port`, `Configurable via env var`.

Saved an `answer` note, previewed, sent:

```
? 1. "Which port should the health endpoint use?" → Configurable via env var.
```

Send called `runtime-request.respond` (no extra chat message, because the draft
had only the answer). `t3 thread show` showed the answer resolved; the agent
replied "Your answer: **Configurable via env var**…". The thread then showed as
`report`.

## 5. Plans: cited review, then approval

Sending a plan review used to just post the composed review. Now:

- **Plan with an objection** → posts the cited review as a normal message (the
  agent revises).
- **Plan with no objections** → approves the plan the way the T3 web app does:
  `message.dispatch` with
  `text = "PLEASE IMPLEMENT THIS PLAN:\n<plan markdown>"` and
  `sourcePlanRef: {threadId, planId}` (plan id from the active
  `proposed_plan` artifact). Reviewer notes, if any, ride along under
  `Reviewer notes from Pinpoint:`.

Verified live on a purpose-built read-only plan ("count test and source files,
change nothing"): preview showed `✓ Reviewed on G2: all 5 points agreed. Go
ahead with the rest of the plan.`; send logged
`[service] approved plan for Pinpoint live: plan approval (no objections)`;
`t3 thread show` showed the exact `PLEASE IMPLEMENT THIS PLAN:` message and the
agent executed the three read-only steps (11 test `.ts` files, 37 source
`.ts` files) and reported back.

Payload shape and prefix follow `docs/t3-api-notes.md` §4 and T3's own
`messages.dispatch` command in `packages/client-runtime/src/operations/commands.ts`.

## 6. Latency

| Step | Observed |
|---|---|
| `GET /api/inbox` (cold shell + transcripts) | 18–36 ms |
| `GET /api/deck` (cached) | 1 ms |
| Deck build, 1-point question | 9.0 s |
| Deck build, 5-point reply | 13.1 s |
| Deck build, 5-point plan | 13.0 s |
| Deck build, first three sandbox threads | 24.7 s, 42.5 s, 43.4 s |
| `PUT` review / `POST` preview | < 10 ms |
| `POST` send (WS dispatch) | 70 ms |

Deck builds run one at a time through a queue, so a cold start with three
threads takes about the sum (≈ 110 s). Cached decks are instant; the inbox
pre-builds new sources in the background.

## 7. Bugs found and fixed

1. **Privacy** — no project filter existed; every T3 thread was readable.
   Added `T3_PROJECTS`, client-side filtering, per-thread gate, and a startup
   refusal in live mode. (Privacy test file added.)
2. **Notes could never be cleared** — `PUT /api/review` merged notes, so
   "Clear notes" and removed notes stayed on disk. A supplied note list now
   replaces the stored one; omitting it keeps it.
3. **Plural bug** — a 1-point deck composed "1 points".
4. **Wrong splitter prompt for plans** — every plan was described to the model
   as `Source kind: reply`; now uses the real source kind.
5. **All-agreed plan text** — said "Continue." for plans; now says "Go ahead
   with the rest of the plan."
6. **No plan approval path** — added the `sourcePlanRef` dispatch described in
   §5.

`npm test` → 10 files, 135 tests passed. `npm run typecheck` → clean.

## 8. Known gaps

- Deck builds are slow on this model (9–43 s) and serialized. A cold start with
  many attention threads queues them; the glasses show `deckReady: false`
  until each finishes.
- A thread whose latest assistant reply is trivia (for example
  `CLI-FALLBACK-OK` from an earlier smoke test) still gets 4 points — every
  quote is exact but the deck is useless. A minimum source length is not
  implemented.
- A plan thread can stay `plan` after a review because the `proposed_plan`
  artifact remains `active` in T3 until the agent supersedes it; Pinpoint keeps
  listing it (correct per SPEC but surprising in a demo).
- Plan approval assumes `sourceMessageId` from `getSource` is the T3 plan id
  (it is for real threads) and relies on the web app's text prefix. If T3
  changes that convention, approval becomes a plain instruction message.
- The preview shows the human sentence; it does not show the literal
  `PLEASE IMPLEMENT THIS PLAN:` prefix that is sent.
- Telegram verification was dry-run only (no bot token on this machine).
- Multi-select questions cannot be answered (`Record<string, string>`), as
  noted in `docs/t3-api-notes.md`.
- Live threads created for this run stay in the `pinpoint` project:
  `Pinpoint live: release checklist review`, `Pinpoint live: port question`,
  `Pinpoint live: plan approval`.
