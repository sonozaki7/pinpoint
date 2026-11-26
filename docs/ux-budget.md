# Interaction budget: never more work than the phone

Owner rule (2026-11-27): if any Pinpoint flow takes more effort than doing the same thing on a phone, people stop wearing it, and judges notice. Every flow below has a gesture budget. Tests in `apps/glasses/test/budget.test.ts` drive the real state machine with scripted inputs and fail if a flow goes over budget.

Gestures: **scroll** (ring swipe), **tap**, **double-tap** (back), **hold** (menu). Speaking one short sentence counts as **voice**.

## Rules

1. **Start where it matters.** Opening an item puts the cursor on the first line Pinpoint flagged (CHECK). A question opens straight on its answer options, with the recommended one focused. With no flags, the cursor starts on line 1.
2. **Move on by yourself.** After a note or an answer, the cursor jumps to the next flagged line, or to Send if none is left. After sending, Pinpoint returns to the inbox with the cursor on the next item that needs you. The user never scrolls to find Send.
3. **Never confirm what you've already seen.** No preview screens and no second review passes. A send is confirmed by a 5-second "Sending… tap to undo" countdown, not by another tap.
4. **Your words, applied exactly, shown in place.** A spoken fix to a draft sentence shows the new sentence on the same screen at once ("Now: …").
5. **Voice stops itself.** Recording ends after about 1.2 s of silence (tapping also stops it). Maximum 30 s.
6. **One obvious next action per screen,** written in words in the footer.
7. **The phone is never required.** It is only the optional escape hatch (Read on phone).
8. **No silent waits.** Anything over 1 s shows "Working…"; a page still being prepared shows as "preparing" in the inbox so the user can handle another item.

## Budgets (from opening the item to done)

| Flow | Phone today | Pinpoint budget |
|---|---|---|
| Agent plan, one flagged mistake | unlock, open, scroll, type, send ≈ 10+ taps + typing | 3 taps + 1 voice |
| Agent plan, mistake not flagged (step 4 of 7) | same | 3 taps + 3 scrolls + 1 voice |
| Agent question (pick an option) | ≈ 5 taps | 2 taps |
| Gmail draft, fix one detail | ≈ 10 taps + typing | 3 taps + 1 voice |
| Gmail draft or Notion page, nothing wrong | ≈ 5 taps | open + read (scrolls) + 1 tap; or from the inbox: hold → Agree (2 gestures) |
| Notion page, one comment | ≈ 8 taps + typing | 3 taps + 1 voice |
| Back to the next item after sending | n/a | 0 (automatic) |

## Where today's app breaks the budget (fixed in the next glasses task)

- A preview screen asks for a second tap before sending → replaced by the undo countdown.
- Recording needs a tap to stop → silence detection.
- The user must scroll past every remaining line to reach Send → auto-advance.
- Questions open on the point list, then the options → open on the options.
- After sending, the user taps back to the inbox → automatic return to the next item.
