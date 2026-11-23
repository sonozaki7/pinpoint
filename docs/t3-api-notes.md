# T3 Code API notes for Pinpoint

Checked live against T3 Code **0.1.11** (desktop beta) on macOS, orchestration
protocol **2**, on 2026-11-24. The client in `apps/server/src/t3/index.ts`
uses only these endpoints. No npm packages were added: reads use `fetch`,
writes use the built-in `WebSocket`.

- Default origin: `http://127.0.0.1:3773`. Confirm with
  `GET /.well-known/t3/environment` (returns `serverVersion` and
  `orchestrationProtocolVersion`).
- Config lives in `apps/server/.env` (gitignored): `T3_URL`, `T3_TOKEN`.

## 1. Token and scopes

Mint one scoped session:

```sh
~/.t3/bin/t3 auth session issue \
  --scope orchestration:read \
  --scope orchestration:operate \
  --ttl 7d \
  --label pinpoint-t3-client \
  --token-only
```

| Scope | Why Pinpoint needs it |
|---|---|
| `orchestration:read` | `GET /api/orchestration/shell`, thread detail, transcript |
| `orchestration:operate` | `POST /api/auth/websocket-ticket` and the `orchestration.dispatchCommand` RPC; also the default guard on `POST /api/voice/transcribe` |

Do not use the full default scope set. The token is a bearer credential: never
log, print, store in Git, or include in an error message. The client keeps it
in memory only.

The `/mcp` endpoint (the tool server `t3 thread …` uses internally) **rejects**
these session tokens with `401 invalid_mcp_credential`. It only accepts MCP
client sessions the server issues in-process. That is why writes go through
the WebSocket RPC instead.

## 2. Reads

All reads send:

```http
Authorization: Bearer <TOKEN>
X-T3-Orchestration-Protocol: 2
Accept: application/json
```

### GET `/api/orchestration/shell`

Query used: `?omitIdleSubagents=1&omitOlderSettled=1` (smaller payload; the
client filters those rows anyway).

Response (trimmed):

```json
{
  "schemaVersion": 2,
  "snapshotSequence": 464855,
  "threads": [
    {
      "id": "mcp:<uuid>",
      "projectId": "mcp:<uuid>",
      "title": "<thread title>",
      "status": "idle",
      "createdAt": "2026-11-23T16:49:12.544Z",
      "updatedAt": "2026-11-23T16:50:11.878Z",
      "archivedAt": null,
      "deletedAt": null,
      "settledAt": null,
      "settledOverride": null,
      "snoozedUntil": null,
      "pendingRuntimeRequest": null,
      "hasActionableProposedPlan": false,
      "latestVisibleMessage": null,
      "latestUserAuthoredMessageAt": null,
      "latestUserMessageAt": null,
      "lineage": { "parentThreadId": null, "relationshipToParent": null, "rootThreadId": "mcp:<uuid>" }
    }
  ],
  "projects": [
    { "id": "mcp:<uuid>", "title": "pinpoint", "workspaceRoot": "/Users/<user>/Desktop/Project/pinpoint" }
  ],
  "archivedThreads": []
}
```

Fields the client relies on:

- `status`: `idle`, `completed`, `failed`, `running`, `waiting`, `queued`,
  `preparing`, `starting`, or a terminal `cancelled` / `interrupted` /
  `rolled_back`.
- `pendingRuntimeRequest`: `{ id, kind, createdAt, blocking?, userOnly? }`.
  `kind` is `command`, `file-read`, `file-change`, `mcp-elicitation`,
  `permission`, `dynamic_tool_call`, `user_input`, or `auth_refresh`.
- `hasActionableProposedPlan`: true while a `proposed_plan` artifact is
  `active`.
- `settledAt` + `settledOverride` (`"settled" | "active" | null`).
- `snoozedUntil`, `archivedAt`, `deletedAt`.
- `lineage.relationshipToParent` (`"fork" | "subagent" | null`) and
  `lineage.sideChat`.
- `latestUserAuthoredMessageAt` (last message the human wrote).

**Important:** in 0.1.11 `latestVisibleMessage` is always `null` on shell rows
(the server keeps message bodies out of shell rows on purpose). To apply the
"latest visible message is from the assistant" rule, the client reads the
transcript for the few threads that could still be plain replies. If a future
server fills the field, the client uses it and skips the extra request.

### GET `/api/orchestration/threads/:threadId`

Returns the full projection for one thread:

```json
{
  "snapshotSequence": 464855,
  "projection": {
    "thread": { "id": "mcp:<uuid>", "title": "<thread title>", "projectId": "<uuid>" },
    "messages": [
      { "id": "message:<uuid>", "role": "assistant", "text": "<full reply>", "streaming": false,
        "createdAt": "2026-11-23T16:50:11.865Z", "updatedAt": "2026-11-23T16:50:11.865Z" }
    ],
    "plans": [
      { "id": "plan:thread:mcp%3A<uuid>", "kind": "proposed_plan", "status": "active",
        "markdown": "# Plan\n..." }
    ],
    "turnItems": [
      { "id": "turn-item:...", "type": "user_input_request", "requestId": "runtime-request:...",
        "questions": [
          { "id": "Which port?", "header": "Port", "question": "Which port should it use?",
            "options": [ { "label": "8080", "description": "" }, { "label": "8787", "description": "" } ] }
        ] }
    ],
    "runtimeRequests": [
      { "id": "runtime-request:...", "kind": "user_input", "status": "pending" }
    ]
  }
}
```

Notes:

- `messages[].text` is the full text; no truncation seen (3.4 KB reply matched
  the transcript byte for byte).
- `plans[]` is the plan artifact list. A plan is actionable when
  `kind === "proposed_plan"` and `status === "active"`; `markdown` is the plan
  the user reviews. `todo_list` entries are checklists, not proposed plans.
- Questions live on `turnItems` of type `user_input_request`, joined to a
  pending entry in `runtimeRequests` by `requestId`.
- There is no separate "answer" field on a pending request; answers appear as
  `runtimeRequests[].answers` after it resolves.

### GET `/api/orchestration/threads/:threadId/transcript`

```json
{
  "threadId": "mcp:<uuid>",
  "title": "<thread title>",
  "updatedAt": "2026-11-23T16:50:11.878Z",
  "items": [
    { "position": 0, "visibility": "local", "sourceThreadId": "mcp:<uuid>",
      "sourceItemId": "turn-item:...",
      "item": { "id": "turn-item:...", "type": "user_message", "text": "…",
                "createdAt": "…", "updatedAt": "…" } }
  ]
}
```

`item.type` includes `user_message`, `assistant_message`, `reasoning`,
`command_execution`, `file_change`, `web_search`, `dynamic_tool`,
`user_input_request`, `proposed_plan`, `todo_list`, and more.
`visibility` is `local`, `inherited`, or `synthetic` (synthetic rows are not
shown to the user and are skipped when finding the latest visible message).

The transcript can be large for long threads, so the client fetches it only
for attention candidates and caches it per thread `updatedAt` for 30 seconds.

## 3. Writes (WebSocket RPC, the T3 web app path)

### POST `/api/auth/websocket-ticket`

```http
POST /api/auth/websocket-ticket
Authorization: Bearer <TOKEN>
```

```json
{ "ticket": "<one-time ticket>", "expiresAt": "2026-11-23T16:53:13.817Z" }
```

The ticket is one-time and short-lived. The client issues a fresh ticket for
each command and never logs it.

### WebSocket `/ws`

```
ws://127.0.0.1:3773/ws?orchestrationProtocol=2&wsTicket=<url-encoded ticket>
```

Every frame is one JSON object (Effect RPC JSON serialization).

Request frame:

```json
{
  "_tag": "Request",
  "id": 1,
  "tag": "orchestration.dispatchCommand",
  "payload": { "type": "message.dispatch", "...": "..." },
  "headers": []
}
```

Success frame (verified):

```json
{ "_tag": "Exit", "requestId": 1, "exit": { "_tag": "Success", "value": { "sequence": 467520 } } }
```

Failure frame:

```json
{ "_tag": "Exit", "requestId": 1, "exit": { "_tag": "Failure",
  "cause": [ { "_tag": "Fail", "error": { "message": "<reason>" } } ] } }
```

A command that streams chunks would send `{"_tag":"Chunk","requestId":1,"values":[...]}`;
the client acknowledges each with `{"_tag":"Ack","requestId":1}`. Unary
commands like `message.dispatch` answer with a single `Exit`.

### `message.dispatch` (send a plain user message)

Payload used (the same fields the web composer sends for a normal send):

```json
{
  "type": "message.dispatch",
  "commandId": "<uuid v4>",
  "threadId": "mcp:<uuid>",
  "messageId": "<uuid v4>",
  "text": "<review text>",
  "attachments": [],
  "createdBy": "user",
  "creationSource": "web",
  "dispatchMode": { "type": "start_immediately" },
  "deliveryIntent": "auto"
}
```

`dispatchMode` alternatives: `queue_after_active`, `steer_active`
(+`targetRunId`), `restart_active` (+`targetRunId`), `defer_start`.
`creationSource` is one of `web`, `mobile`, `mcp`, `provider`, `server`.

Verified live: sending a review to the sandbox thread produced a new user
message, the provider replied, and the reply appeared in the transcript.

Fallback (only when the socket path fails): spawn
`~/.t3/bin/t3 thread send <threadId> -` and write the text to stdin. That CLI
uses the MCP tool `t3_thread_send` with its own in-process session. Exit code 2
means the thread is waiting for an answer. The client prefers the socket; the
CLI path exists so a demo survives a protocol change in the socket route.

### `runtime-request.respond` (answer a pending question)

```json
{
  "type": "runtime-request.respond",
  "commandId": "<uuid v4>",
  "threadId": "mcp:<uuid>",
  "requestId": "runtime-request:...",
  "answers": { "Which port?": "8787" }
}
```

`answers` is keyed by **question id**, not header text. Each value is the chosen
option's `value` when the option defines one, otherwise its `label`; a custom
typed answer is passed as the raw string. Pinpoint's `Record<string, string>`
cannot express multi-select answers (arrays); a multi-select question would
need a contract change. Approvals (`kind: "command"`) use `decision` +
`feedback` instead of `answers` and are out of scope for Pinpoint (Even's
Terminal Mode already covers them).

Verified live: a Claude thread asked "Which port should the health endpoint
use?" with options 8080 / 8787. `listAttention` returned `question`,
`getSource` returned the question and options, and answering `{"Which port
should the health endpoint use?": "8787"}` resolved the request; the provider
replied "You picked 8787…".

## 4. Plans and questions: how Pinpoint reads them

Attention rules (SPEC §6), implemented in `attentionFromSnapshot` /
`attentionKind`:

1. Eligibility: not archived, not deleted, not settled
   (`settledOverride === "active"` wins over `settledAt`), not snoozed
   (`snoozedUntil` in the future), not a subagent child
   (`lineage.relationshipToParent === "subagent"`) and not a side chat.
2. `pendingRuntimeRequest.kind === "user_input"` → `question`.
3. `hasActionableProposedPlan` → `plan`.
4. `status === "failed"` → `failed`.
5. `status` is `idle` or `completed`, and the latest visible message is from
   the assistant and newer than `latestUserAuthoredMessageAt` → `report`.

Rows sort question → plan → failed → report, newest first inside a kind.

`getSource` priority: pending `user_input` question (text = question text,
options = option labels) → active `proposed_plan` markdown → latest
non-streaming assistant message (`reply`). A plan still counts after its run
completes; it stops counting when the status changes to `completed` or
`superseded`.

Sending a plan review: the T3 web app has no "approve plan" command. The user
writes feedback in the composer, which is a normal `message.dispatch`; in plan
mode the agent reads it as plan feedback and proposes an updated plan. Pinpoint
therefore uses `sendMessage` for both replies and plans. If Pinpoint ever wants
the "implement this plan" shortcut, it would send
`PLEASE IMPLEMENT THIS PLAN:\n<markdown>` (the web app's prefix) and could set
`sourcePlanRef: { threadId, planId }`.

## 5. Voice transcription (for `src/voice`)

`POST /api/voice/transcribe` with `Authorization: Bearer <TOKEN>`, body =
raw audio bytes (WAV or headerless PCM; the server sniffs the format), success
`{ "text": "<transcript>" }`. Scope: `orchestration:operate` (the endpoint's
default guard). Max body size is enforced by the server (`413` when over).
`POST /api/voice/status` reports whether a local model is ready.

## 6. Failure modes seen

| Symptom | Cause | Fix |
|---|---|---|
| `401` on shell | token expired / revoked | mint a new session, update `.env` |
| `401 invalid_mcp_credential` on `/mcp` | session token used on MCP route | expected; use `/ws` |
| `426` on `/ws` upgrade | missing/incompatible `orchestrationProtocol` | send `orchestrationProtocol=2` |
| WS closes before `Exit` | ticket reused or expired | issue a fresh ticket per command |
| Shell returns `latestVisibleMessage: null` everywhere | server 0.1.11 behavior | read the transcript for report candidates |

## 7. Live proof (2026-11-24, this machine)

- Sandbox thread `mcp:efb16037-afe1-4bf0-be0e-fa413f204a71`
  ("Pinpoint sandbox: 5-step /health plan", opencode / opencode-go deepseek
  v4.1 flash): reply appeared in `listAttention` as `report`; `getSource`
  returned the full 2.4 KB reply; `sendMessage` delivered
  "PINPOINT-RECEIVED-2" and the agent replied exactly that.
- Sandbox thread `mcp:b0840a2d-eb82-4a62-a4e1-e31959b25f7b` (Claude plan
  mode): `hasActionableProposedPlan: true`, `listAttention` → `plan`,
  `getSource` → `kind: "plan"` with the 1.9 KB markdown.
- Sandbox thread `mcp:9b63db13-0aa9-4dd4-b195-f25ea48e54f9` (Claude): pending
  `user_input`, `listAttention` → `question`, `getSource` returned the
  question and options, `answerQuestion` resolved it with `8787`.

No existing user thread was sent to during verification.
