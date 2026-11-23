# Pinpoint hardening review — 2026-11-24

Independent pass before judges run the demo. No commits were made. No token
or key is printed in this file. The shared contract, the site, and the film
were not touched.

One command for judges: `npm run demo` installs missing dependencies, starts
the demo server and glasses preview, prints the simulator command and URLs,
and stops both processes on Ctrl-C. `npm run check` runs every check below.

## Check results

| Check | Before | After |
|---|---|---|
| `npm --prefix apps/server test` | 11 files, 144 tests passed | 13 files, 155 tests passed |
| `npm --prefix apps/server run typecheck` | clean | clean |
| `npm --prefix apps/glasses test` | 12 tests passed | 19 tests passed |
| `npm --prefix apps/glasses run build` | passed | passed |
| `npm --prefix apps/glasses run test:ui` | passed | passed (Chrome, 320–1440 px, offline screen, send flow, exit mode 1) |
| `node demo/scripts/verify-fixtures.mjs` | 4 fixtures, 25 points, 421 checks | same |

`npm run check` (the root script that runs all six checks in order) passes.

`npm run demo` smoke run: server health
`{"ok":true,"mode":"demo","t3":"off","telegram":"dry-run","splitter":"fixture"}`,
glasses preview HTTP 200, both still healthy after 20 seconds, Ctrl-C stopped
both processes and freed ports 8787 and 4173.

## Findings and fixes

| Issue | Severity | Fix | Test |
|---|---|---|---|
| JSON bodies were unbounded; a huge `PUT /api/review` could exhaust memory | High | Stream-read JSON with a 256 KB cap; reject with 413 `too_large` when `content-length` or the actual stream crosses it | `test/hardening.test.ts` "rejects JSON bodies over 256 KB" |
| `/api/voice` read the whole body before checking size | High | Same capped reader, limit = exactly 25 s of s16le PCM (800,000 bytes); the stream is cancelled the moment it crosses | `test/hardening.test.ts` "accepts exactly 25 s of PCM and rejects one sample more" |
| CORS reflected `*` in live mode, so any web page could read private threads | High | Demo keeps `*`; live echoes only `PINPOINT_ALLOWED_ORIGINS` entries and the documented Even WebView pattern `https://*.evenrealities.com`; `null` can be configured for an opaque origin | `test/hardening.test.ts` live CORS cases |
| `answerQuestion` could write outside `T3_PROJECTS` when its projection read failed (the catch swallowed the allowlist error) | High | Assert the allowlist before the projection read; the write path now always gates first | `test/privacy.test.ts` "refuses to answer a question outside the allowlist…" |
| Two send requests arriving together both composed and delivered the same draft | High | Register the thread in an in-flight set before the first await; the second request gets 409 `conflict` | `test/hardening.test.ts` "turns a concurrent double send into one delivery and one 409" |
| Deck builds were keyed only by thread, so a caller could receive a build for an older reply; concurrent requests could also start duplicate builds | Medium | Queue key is now thread + source message; concurrent callers share one promise and a new source gets a fresh build | `test/hardening.test.ts` "dedupes concurrent deck builds…" |
| Provider/T3/Telegram errors could echo credentials into logs or HTTP errors | Medium | `redactSecrets` for bot tokens, bearer values, tickets, JWTs and API keys; `errorMessage` and `HttpError` redact before logging or returning | `test/redact.test.ts` |
| `GET /api/review/:threadId` returned an empty draft for any guessed thread id | Medium | 404 unless a stored draft, a cached deck, or an allowlisted T3 thread exists | `test/hardening.test.ts` "returns 404 for a review on a thread it does not know" |
| Two autosaves in the same millisecond used the same temp file, so one rename could fail | Medium | Random temp suffix per save | `test/reviews.test.ts` "does not lose a save when two autosaves land in the same millisecond" |
| Glasses silently replaced an unreachable live server with demo data, hiding the problem | High | Boot now keeps the live client and shows `Server unreachable · tap to retry`; `?mock=1` remains the explicit demo switch | `test/hardening.test.ts` offline page + `scripts/check-ui.mjs` offline browser check |
| A deck that was still building after the wait left the review screen inert | Medium | Wait up to 60 s for a 202; then show "Tap to retry" and make tap/menu retry the deck | `test/hardening.test.ts` "offline, empty inbox and a failed deck…" |
| Fast ring/touch scroll events could move several points at once | Medium | 250 ms swipe debounce with a pure, tested gate | `test/hardening.test.ts` "swipes are debounced…" + UI timing |
| The hold menu could send before the preview was composed | High | `canSend` requires a loaded, not-loading preview; the menu opens the preview instead of sending | `test/hardening.test.ts` "send requires a loaded preview…" |
| Bridge writes (including the exit dialog) could overlap while a rebuild was in flight | Medium | `SerialWrites` serializes display and exit calls; a failed write does not stall the queue | `test/hardening.test.ts` "bridge writes run one at a time…" |
| Menu could be lost on page rebuild | Low | Verified every `rebuildLayout` re-declares the menu; no code change needed beyond the test | `test/hardening.test.ts` "every rebuild re-declares the hold menu" |
| Root double-tap exit was untested | Medium | Test covers inbox exit, review/options/preview back, and sending lock; UI test checks `shutDownPageContainer(1)` | `test/hardening.test.ts`, `scripts/check-ui.mjs` |
| Recorder buffered unbounded PCM and kept views of host-reused audio frames | Medium | 25 s cap, copied frames, 20 s auto-stop still applies | `test/voice.test.ts` |
| Inbox refresh could race itself during boot/retry | Low | Single in-flight inbox load; a deck retry now retries the deck instead of reloading the inbox | covered by model retry test and UI flow |
| Debounced autosave could land after send and re-create the cleared draft | Medium | Save timer is cleared before sending and when returning to the inbox | covered by the send flow in `scripts/check-ui.mjs` |

## Open items

1. **Even WebView origin is not verified on a physical phone.** Live CORS
   covers `https://*.evenrealities.com` and anything listed in
   `PINPOINT_ALLOWED_ORIGINS`. The simulator preview needs
   `PINPOINT_ALLOWED_ORIGINS=http://127.0.0.1:4173` in live mode. If the phone
   WebView reports an opaque `null` origin, add `null` to that variable. This
   is documented in `apps/server/.env.example` and in the CORS comment.
2. **Live T3 and Telegram were not re-run in this pass.** No real thread was
   read or messaged; the live T3 results are the earlier `docs/live-run.md`
   run, and Telegram was dry-run only. The demo never touches either.
3. **Simulator only.** No physical G2/R1 was available; real fonts, BLE
   timing, and ring-vs-temple input remain unverified.
4. **Cold live decks are slow.** Builds run one at a time (9–43 s observed).
   The glasses now wait 60 s and then offer retry, but a cold start with many
   attention threads still queues.
5. **Sequential duplicate send is not idempotency-keyed.** Concurrent sends
   return 409. After a completed send the glasses hides the thread and blocks
   repeat taps; a direct second POST for the same source would compose an
   empty/all-agreed review. Add an idempotency key if this becomes a concern.
6. **`test:ui` needs Chrome or a Playwright Chromium download.** It found
   Google Chrome on this Mac. On a clean Linux machine, run
   `npx playwright install chromium` first, or install Chrome.
7. **Demo state is local.** The demo writes decks/drafts under
   `apps/server/.data`; it is gitignored and safe to delete between runs.
8. **No contract changes were needed.** `shared/contract.ts` and
   `docs/requests.md` were left untouched.
