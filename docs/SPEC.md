> **SUPERSEDED (Nov 27 2026). Kept as the original v1 design record. Do not use it as the current spec.**
> Pinpoint is now "the attention layer for your AI agents": it shows what needs you, sorts output to decisions, and sends your words where they belong. This file still describes the first idea: reviewing only T3 Code agent replies from a local server.
>
> | Section here | What changed | Read instead |
> |---|---|---|
> | Title, §1 problem and insight | Positioning, audience and the 5 capabilities | [README.md](../README.md) |
> | §2 architecture | Pinpoint Cloud + desk relay, sources beyond T3 | [README.md](../README.md#architecture), [desk-pairing.md](desk-pairing.md), [apps/server/CLOUD.md](../apps/server/CLOUD.md) |
> | §3 repo layout and ownership | Owners and layout changed (`apps/web`, `apps/site`, `deploy`) | [README.md](../README.md#repo-map) |
> | §4 shared types, §5 API | Many new fields and routes (status, catch-up, Ask, edit, task, pairing) | [shared/contract.ts](../shared/contract.ts) |
> | §6 T3 client | Still accurate for T3 | [t3-api-notes.md](t3-api-notes.md) |
> | §7 splitter | Now also sorts to "needs you", with grounded evidence; DeepSeek is the default model | [connectors.md](connectors.md), `apps/server/src/core/` |
> | §8 composer | Still accurate for agent reviews | `apps/server/src/core/composer.ts` |
> | §10 glasses UX | Preview screen removed; 5 s undo, auto-advance, voice auto-stop, words not symbols | [ux-budget.md](ux-budget.md), [apps/glasses/README.md](../apps/glasses/README.md) |
> | §11 Telegram | Status icons, one notifying card, receipts | [telegram-setup.md](telegram-setup.md) |
> | §13 acceptance | Replaced by tests and the submission checklist | [SUBMIT-CHECKLIST.md](SUBMIT-CHECKLIST.md) |
>
> Notion pages and Gmail drafts as review sources are not in this file at all: [connectors.md](connectors.md).

# Pinpoint — product and build spec (v1, 2026-11-24)

**One line:** review your AI agents' replies and plans on Even G2, point by point. *Ring for where, voice for what.*

Hackathon: Heads Up (Even Realities × TVM Ventures), deadline **Mon Nov 30 04:59 JST**. Simulator-only demo (no hardware). Main track: AI Assistants & Work. Second track: Messaging & News (Telegram). Also targets "Best Telegram integration".

## 1. Problem and insight

- Agents (T3 Code running Claude Code / Codex / OpenCode) stop and wait for a human. Away from the laptop, existing glasses tools (Even's Terminal Mode, OcuClaw, cc-g2) let you *approve* or speak one direction. None let you *critique what the agent said*, which is what actually steers it.
- On a laptop you select text because raw text is the only structure. The agent does not need selected words. It needs **which step or claim**, **your verdict**, and a **short reason**.
- So: AI splits each reply into 4–10 one-line **points**, each anchored to an **exact quote** of the reply. The ring moves between points. **Silence = agree.** Tap, talk, tap to object. Pinpoint writes the cited review and sends it to the agent.
- Telegram fills the glasses' two gaps: alerts while the app is closed (the glasses mirror phone notifications) and long technical text (full reply in a Telegram topic, your notes as quote-replies on the exact sentence).

## 2. Architecture

```
Even G2 + R1 ⇄ phone (Even app WebView) = apps/glasses ⇄ HTTP ⇄ apps/server (runs on the Mac next to T3 Code)
                                                             ├─ src/t3        T3 Code HTTP/WS API (threads, plans, questions, send)
                                                             ├─ src/core      decks, splitter (LLM), composer, review store
                                                             ├─ src/voice     speech-to-text (T3 /api/voice/transcribe or whisper-cli)
                                                             ├─ src/telegram  Bot API via grammY (topics, alerts, quote-replies, links)
                                                             └─ src/http      routes for the glasses (CORS)
```

The glasses app talks only to apps/server. No secrets in the app or the repo (`.env` is gitignored; ship `.env.example`).

## 3. Repo layout and ownership (one writer per path)

| Path | Owner | Notes |
|---|---|---|
| `shared/contract.ts` | Opus | Types shared by glasses and server. Need a change? Write it in `docs/requests.md`. |
| `apps/glasses/` | glasses agent | Started from Agent Relay's app (see `PRIOR_WORK.md`). npm, Vite, TS, `@evenrealities/even_hub_sdk` 0.0.16. |
| `apps/server/package.json`, `src/core`, `src/voice`, `src/http`, `src/index.ts` | server agent | Node 22, TS (ESM), Hono + @hono/node-server, zod, vitest, tsx. Only this agent adds dependencies. |
| `apps/server/src/t3/` | t3 agent | Implements `T3Client` (section 6). Writes `docs/t3-api-notes.md`. |
| `apps/server/src/telegram/` | telegram agent | grammY. Dry-run mode when no token. |
| `apps/site/` | site agent | Landing page. |
| `demo/` | demo agent | Fixtures, simulator scripts, film (Remotion, imported from Agent Relay). |
| `docs/` | anyone may add files; `SPEC.md` and `exec-plans/` are Opus-owned | |

Agents do **not** commit; Opus commits at checkpoints. Never touch paths you don't own. Never print or commit secrets.

## 4. Shared types

See `shared/contract.ts`. Summary: `InboxItem`, `Deck` (list of `Point`), `Note`, `ReviewDraft`, `PreviewResult`, `SendResult`.

## 5. Server HTTP API (JSON, CORS for the glasses origin)

| Method & path | Returns | Notes |
|---|---|---|
| `GET /api/health` | `{ ok, mode, t3, telegram, splitter }` | |
| `GET /api/inbox` | `{ items: InboxItem[], updatedAt }` | Sorted: question, plan, failed, report; newest first within a kind. |
| `GET /api/deck/:threadId` | `Deck` | Built on demand if missing (splitter), cached by `sourceMessageId`. 202 `{pending:true}` while building. |
| `PUT /api/review/:threadId` | `ReviewDraft` | Autosave notes and seen points. |
| `POST /api/review/:threadId/preview` | `PreviewResult` | Composed message + 2-line preview. |
| `POST /api/review/:threadId/send` | `SendResult` | Sends to T3 (live) or logs (demo); posts to Telegram if configured; clears the draft. |
| `POST /api/voice` | `{ text }` | Body: raw PCM s16le 16 kHz mono (`application/octet-stream`). Max 25 s. |
| `POST /api/phone/:threadId/:pointId` | `{ ok, link? }` | "Read on phone": Telegram quote-reply on that point, returns its t.me link. |

Modes: `PINPOINT_MODE=demo` serves `demo/fixtures/*.json` (deterministic, no T3 needed — judges can run it); `live` uses T3. Port `PINPOINT_PORT` (default 8787).

## 6. T3 client (`apps/server/src/t3`)

```ts
export interface AttentionThread { threadId: string; title: string; project: string; attention: ThreadAttention; updatedAt: string; }
export interface T3Client {
  listAttention(): Promise<AttentionThread[]>;
  getSource(threadId: string): Promise<{ sourceMessageId: string; text: string; kind: 'plan' | 'reply' | 'question'; question?: { requestId: string; questions: { id: string; question: string; options: string[] }[] } }>;
  sendMessage(threadId: string, text: string): Promise<void>;          // plain user message to the thread
  answerQuestion(threadId: string, requestId: string, answers: Record<string, string>): Promise<void>;
}
```

Source: `GET /api/orchestration/shell` on the T3 server (default `http://127.0.0.1:3773`, bearer token minted with `~/.t3/bin/t3 auth session issue ... --token-only`; store in `apps/server/.env` as `T3_TOKEN`). Shell thread fields that matter (see `packages/contracts/src/orchestrationV2.ts` in `/Users/so/Desktop/Project/t3code`): `status`, `pendingRuntimeRequest {kind, blocking}`, `latestVisibleMessage {role, text}`, `hasActionableProposedPlan`, `settledAt`, `snoozedUntil`, `archivedAt`, `deletedAt`, `lineage`, `latestUserAuthoredMessageAt`, `lastError`.

Attention rules (a thread qualifies only if not archived, not deleted, not settled, not snoozed, and not a subagent child):
1. `pendingRuntimeRequest.kind === 'user_input'` → `question`
2. `hasActionableProposedPlan` → `plan`
3. `status === 'failed'` → `failed`
4. idle/completed and the latest visible message is from the assistant and newer than `latestUserAuthoredMessageAt` → `report`

Permission approvals (`kind === 'command'`) are out of scope; Even's Terminal Mode already covers them.

## 7. Splitter (`src/core/splitter`)

- Input: the source text (markdown). Output: `Point[]` (zod-validated JSON).
- Prompt rules: 4–10 points; for plans, one point per step, in order; `glance` ≤ 44 chars, plain ASCII (no emoji, no markdown) because the G2 font is limited; `quote` = verbatim substring of the source, ≤ 200 chars, copied exactly; questions get 2–4 `options` (≤ 24 chars, recommended first); mark destructive or irreversible steps `risk: 'high'`; `kind` from `step | claim | question | risk | draft`.
- **Quote verification:** keep a point only if its quote is found in the source (exact, then whitespace/markdown-normalized). Otherwise replace it with the best-matching source sentence, or drop the point. Never invent text.
- Reviewer providers: DeepSeek wins when `DEEPSEEK_API_KEY` is set; otherwise `SPLITTER_PROVIDER=opencode` (default: spawn `opencode run` with model `opencode-go/deepseek-v4.1-flash`), `anthropic` (`ANTHROPIC_API_KEY`), or `fixture` (precomputed decks in `demo/fixtures`). 60 s timeout; fallback is a naive sentence/list split. There is no OpenRouter path.
- Cache decks in memory plus `apps/server/.data/decks/*.json`, keyed by `sourceMessageId`. Pre-build decks as soon as a thread enters the inbox, so opening one is instant.

## 8. Composer (`src/core/composer`, deterministic, no LLM)

```
Review from G2 (Pinpoint) — 7 points
✗ 4. "Force-logout every user by truncating the sessions table" → No. Migrate existing sessions instead.
✗ 6. "Wrap refreshToken() in a mutex" → Use a request queue; a mutex deadlocks with the retry path.
? 2. "Upgrade to Vite 7 now?" → Stay on 6 for now.
● 5. "Add a 30s timeout" → Make it configurable.
✓ Agreed: 1, 3, 7. Go ahead with the rest of the plan.
```

Order: objections, answers, notes, agreed. Quotes longer than 140 chars are cut with `…`. Point numbers are 1-based. No notes at all: `✓ Reviewed on G2: all N points agreed. Continue.` The last line says "Go ahead with the rest of the plan." for plans and "Continue." otherwise. The 2-line preview for the glasses uses ASCII only, for example `2 objections, 1 answer, 3 agreed` / `Tap to send to auth-refresh-fix`.

## 9. Voice (`src/voice`)

Glasses: tap on a focused point → `audioControl(true)` → buffer `audioEvent.audioPcm` frames → tap again (or 20 s) → stop → `POST /api/voice` → text. Server: prefer T3's own transcription endpoint (`/api/voice/transcribe`, local model already on this Mac); fallback `whisper-cli` with a downloaded `ggml-base.en` model. A note is an `object` if the text starts with no / don't / not / wrong / instead / stop / never; otherwise a `note`.

## 10. Glasses UX (`apps/glasses`)

Display facts: 576×288, one fixed font, ~10 lines at 27 px, ≤ 8 text containers and 1 event-capturing container per page, in-place `textContainerUpgrade` is flicker-free, `rebuildPageContainer` changes layout (brief flash). Brightness `textColor` 0–4 per container (avoid 0). Verify glyphs ✓ ✗ ● ○ ▶ in the simulator; fall back to `+ x * o >`. Reuse Agent Relay's `even.ts` / `events.ts` / `display.ts` patterns (handle taps arriving on `sysEvent`, `textEvent` or `listEvent`; `eventType ?? CLICK`; serialize bridge writes; debounce swipes ~250 ms).

Screens:

1. **Inbox (root page).** Header `PINPOINT · 3 need you`. Native list (≤ 20 rows, ≤ 64 chars): `? deps-upgrade · question`, `> auth-refresh-fix · plan, 7 steps`, `! flaky-e2e · run failed`, `* inbox-morning · 4 drafts`. Swipe moves (native), tap opens the deck, **double-tap calls `shutDownPageContainer(1)` (mandatory exit dialog)**. Empty state: `All clear. Your agents are working.` Offline: `Server unreachable · tap to retry`.
2. **Review.** Header `auth-refresh-fix · 4/7 · x2 *1`. Four point rows (focused brightness 4, others 2), each `o 4 Force-logout all users` with markers `o` unseen, `+` agreed (seen), `x` objection, `*` note, `?` question unanswered, `=` answered, and `!` before high-risk points. A quote pane (2–3 lines) shows the focused point's exact quote, or the options for a question. Footer `tap: talk · 2x: back`. After the last point there is a row `> Send review (2 notes)`.
   - Swipe up/down: move focus; window scrolls by re-rendering the 4 rows in place.
   - Tap on a point: start recording (quote pane `* REC 3s · tap to stop`); tap again to stop; show the transcript; the marker becomes `x` or `*`.
   - Tap on a question: open **Options**.
   - Tap on the Send row: open **Preview**.
   - Double-tap: back to Inbox; the draft is kept (autosave).
   - Hold menu (`menuObject`, re-declared on every rebuild): `Send review`, `Read on phone`, `Clear notes`, `Refresh`.
3. **Options.** List of the agent's options plus `Say something else` (voice). Tap selects and returns to Review.
4. **Preview.** The 2-line preview plus `tap: send · 2x: back`. On send: `Sent to agent` for 1.5 s, then Inbox.

## 11. Telegram (`src/telegram`)

Setup: one private supergroup with Topics enabled ("Pinpoint Desk"), bot is admin. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Without a token, run in **dry-run** (log every intended call), so tests and the demo work without a bot.

- **Thread enters the inbox:** ensure a topic per thread (`createForumTopic`, name = thread title), post a header `Needs you · plan · 7 points` and the full source reply in HTML (code fences → `<pre>`, long parts → `<blockquote expandable>`, split ≤ 4000 chars). Persist message ids. This message notifies the phone, and the glasses mirror the notification.
- **Review sent:** post the composed review as a reply to the source message, and each objection/note as a **quote-reply** (`reply_parameters.quote` = exact quote; fall back to a plain reply if Telegram rejects the quote).
- **Read on phone:** quote-reply `Point 4 — from your glasses` on that point; return its link (`https://t.me/c/<chat id without -100>/<message id>?thread=<topic id>`).
- **Phone-side shortcut:** inline button `Agree all & continue` on the header message → sends `✓ Reviewed on phone: all points agreed. Continue.` to T3.
- Respect rate limits (≤ 1 message/s per chat; retry on 429 with `retry_after`).

## 12. Demo fixtures (`demo/fixtures/`)

Realistic, deterministic threads (source text + precomputed deck):
1. `auth-refresh-fix` — plan, 7 steps; step 4 is risky (truncate sessions → force-logout everyone), step 6 is a mutex around `refreshToken()`.
2. `deps-upgrade` — question: "Upgrade to Vite 7 now or stay on 6?" Options: `Stay on 6 for now`, `Upgrade to 7`, `Upgrade in a branch`.
3. `inbox-morning` — report from an inbox-triage agent with 4 draft replies (Track 4: "clear your inbox in 30 seconds").
4. `flaky-e2e` — failed run with the agent's diagnosis.

## 13. Acceptance

| ID | Requirement | Proof |
|---|---|---|
| A1 | Simulator: Inbox → Review → voice note → Options → Preview → Send; root double-tap opens the exit dialog | Simulator automation script + screenshots in `demo/shots/` |
| A2 | Live: a real T3 thread's reply becomes a deck; the sent review appears in that T3 thread | Script output plus a thread read |
| A3 | Telegram with a real bot: topic, full post, quote-replies, read-on-phone link | Message ids/links in log |
| A4 | Voice: simulator mic or a WAV fixture → transcript in a note | Test output |
| A5 | Landing page live on the user's domain | URL returns 200 |
| A6 | Demo video ≤ 3:00 rendered | `demo/out/pinpoint-demo.mp4` |
| A7 | README (setup, prior-work disclosure, feature requests); repo public at submission | Repo |
| A8 | `.ehpk` packaged | File + `evenhub pack` output |

## 14. Conventions

TypeScript strict, ESM, Node 22. Small files. Unit tests with vitest (server) / tsx --test (glasses, as in Agent Relay). Every agent ends with a ≤ 150-word report: what works (with the command that proves it), what doesn't, what's next.
