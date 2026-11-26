# Landscape: what already exists on Even G2, and where Pinpoint fits

Research date: **27 Nov 2026** (hackathon build week, 2 days before submission).
Purpose: decide which integrations Pinpoint should extend into, using evidence rather than guesses.

How this was gathered (so the numbers can be re-checked):

- **The live store was read through its own API**, not by eyeballing the page. The catalogue at
  <https://hub.evenrealities.com/catalogue> is a JavaScript app; its network calls hit
  `https://hub.evenrealities.com/api/v1/storefront/discovery`, `/list`, `/detail?package_id=…` and `/search?q=…`.
  `/list` reports a total of **1,148 published plugins** and pages up to 200 at a time, so every count below comes
  from the full set, not a sample.
- **The hackathon Builds tab became public on 27 Nov.** <https://dorahacks.io/hackathon/even-realities/build>
  now lists **113 builds** (2 of them private). Read by loading the page and clicking “View More” until it stopped.
- **GitHub** search API for repos created after 15 Nov 2026, plus repo READMEs for the closest rivals.
- **Sentiment** from press reviews, the catalogue’s own Discord quote strip, and store listing copy.
  Reddit blocks scripted access (HTTP 403 to JSON and to scrapers), so no Reddit quotes are used here.

---

## TL;DR — the five findings that decide scope

| # | Finding | Evidence |
|---|---|---|
| 1 | **“Clear my inbox” is now the crowded Track 04 idea.** 5+ of the 16 AI-Assistants builds are meeting-brief + inbox-triage apps, and three of them already promise an AI reply saved as a Gmail draft. | <https://dorahacks.io/hackathon/even-realities/build> |
| 2 | **Telegram on G2 is saturated**: 51 of 113 builds are Messaging & News, Telegram dominates, and the store has 8+ Telegram clients. Two hackathon builds already do “approve an AI-drafted reply with one tap”. | same |
| 3 | **Nobody reviews long AI output point by point.** Every shipping coding-agent app shows a linear transcript and asks approve/deny; the closest concept in the hackathon decomposes *your own article* into decisions, not an agent’s plan into anchored objections. | CodeAside, GlanceCode, Breakpoint, Chengzhang (below) |
| 4 | **Notion is the open door**: 4 store apps, all browse/search/task-list; the Notion API can attach a comment to a **specific block**, which is exactly our “exact sentence” model. | <https://developers.notion.com/reference/create-a-comment> |
| 5 | **Even itself tells you not to make people dictate**: the judging rubric asks for “smart defaults or AI drafts instead of long dictation”. Yet no app lets you *correct* a draft line by line — they either send your words or generate new ones. | <https://dorahacks.io/hackathon/even-realities/detail> |

---

## A. What exists, by category

Density is judged on the whole store (1,148 plugins) plus the 113 hackathon builds.
The store publishes no install count or star rating anywhere: `/detail` returns only name, creator, tagline,
description, icon, category, tags and version. Traction is therefore shown by editor’s-choice and trending placement.

### A1. Store-wide density (name or tagline names the thing)

| Theme | Apps | Verdict |
|---|---|---|
| Calendar | 15 | **Crowded** (read-only viewers) |
| AI agents / assistants (agent, claude, codex in name/tagline) | 21 named, 107 mention agents/LLMs in the description | **Crowded** at the “chat with your agent” level |
| Messaging (any platform, incl. descriptions) | 114 | **Very crowded** |
| Email | 5 name it, 72 mention mail | **Crowded for read + draft** |
| Notion | 4 | **Open** |
| Store categories overall | Productivity 196 · Entertainment 196 · Lifestyle 186 · Utilities 171 · Travel 114 · AI 89 · Education 77 · Music 63 · Health 56 | — |

Source for all counts: `hub.evenrealities.com/api/v1/storefront/list` (total 1,148), read 27 Nov 2026.
For scale: a community OCR of the store in July 2026 found ~248 installable apps, so the catalogue has grown
more than four-fold in four months (<https://note.com/gpsnmeajp>).

### A2. Category table

| Category | App | What it does | Input pattern | Traction signal | Crowded? |
|---|---|---|---|---|---|
| **AI agent** | **OcuClaw** | OpenClaw/Hermes client; multi-agent kanban, scheduled briefings, agent approves from ring | ring approve, voice, silent swipe-typing | **Editor’s choice; trending #2**; long Discord praise on the catalogue page | Yes (deepest incumbent) |
| **AI agent** | **IRIS** | Live captions, mid-conversation answers, meeting notes, memory of people, Workspace/calendar sync | voice + auto | **Trending #10**; catalogue quote “IRIS is so good that it’s literally justified the cost of my glasses” | Yes |
| **AI agent** | Chromatic | Bring-your-own-model agent, no server | voice | store listing | Yes |
| **Coding agent** | CodeAside | Claude Code sessions on G2: read live transcript, approve/deny tool calls, hold-to-talk | approve/deny + voice | store listing; “A long reply starts at its first line, so you read it from the top” | Yes |
| **Coding agent** | GlanceCode | Same shape for Claude Code / Codex / Gemini CLI | approve/deny + voice | store listing | Yes |
| **Coding agent** | G2C (ex-TMUXor) | Fleet view of Claude Code + Codex sessions in Herdr | list + tap | store listing | Yes |
| **Coding agent** | Claude Code HUD / Claude Remote / Claude Remote KO / Claude Code G2 / BetterCC / Claude Code Remote | Watch or drive a Claude Code session | mostly approve + short instruction | store listings | **Very crowded** |
| **Coding agent (first party)** | **Terminal Mode** | Persistent agent status icon, alerts when the agent needs you, canned replies or voice from the ring | quick replies + voice | shipped by Even; <https://www.evenrealities.com/pages/terminal> | **Owned by the platform** |
| **Email** | Soveli Mail | Gmail read + reply; dictate word-for-word **or speak the gist and let AI write the full reply in context**, read back before send | dictation **and** AI draft | store listing | Yes |
| **Email** | Gmail Inbox | Read-only Gmail via your own Google Cloud project | read | store listing | Yes (read layer) |
| **Email** | LensMail | Outlook/M365 read, organise, send | read + send | store listing (v3.5) | Yes |
| **Email** | Chesly: All Messages | Paid inbox for mail + 8 messengers, voice replies in 60 languages | dictation | commercial; US$9.99/mo Plus per user reports (<https://chesly.app/g2>) | Yes |
| **Calendar** | Agenda G2, Calendar G2, G2 Calendar, Calendar for G2, Glance Calendar, Simple Calendar | Day/week/month viewers, some read Google Calendar | swipe + tap | store listings | **Very crowded, all read-only** |
| **Notion / docs** | Notion | Browse Notion databases | swipe/tap | store listing | Open |
| **Notion / docs** | Notion Vision | Browse and scroll pages, nested subpages, offline cache | swipe, “no ring required” | store listing | Open |
| **Notion / docs** | Notion Talk | Speak to search and update Notion | voice | store listing | Open |
| **Notion / docs** | Ultimate Brain (GTD) | Browse a GTD workspace | swipe/tap | store listing | Open |
| **Notion / docs** | Docs Reader / DocuLens | Read Google Docs, PDFs, EPUBs | swipe | store listings | Read-only, crowded-ish |
| **Messaging** | Messages (Beeper) | All messengers via Beeper Desktop; **preset quick replies** | quick-reply templates | **Editor’s choice; trending #8** | Yes |
| **Messaging** | GazeChat | “Most feature-complete messenger”; WhatsApp/Telegram/Signal/iMessage/Discord/Slack via your own Beeper gateway | typing on phone, voice notes, dictation | store listing | Yes |
| **Messaging** | TeleGlance, G2gram, Elegram, Talks–Telegram, G2Telegram, G2 Telegram Viewer, VozGram | Telegram read (+ short/voice reply) | templates, dictation | store listings; TeleGlance open source | **Very crowded** |
| **Messaging** | Slack Lens | **Triage one Slack card at a time**: Read / Keep unread / Bookmark, plus 3 reactions | 3-way one-tap decision | store listing | Best design precedent for us |
| **Messaging** | Discord Lens | Channel viewer | swipe/tap | store listing | Thin |
| **Meetings** | IRIS, TriageG2 (hackathon), Glance Brief (hackathon), FUSE Brief, Next Up, G2 Meeting Brief | Brief before the meeting, follow-up after | one glance + one tap | IRIS is a trending store app; the rest are hackathon-week | **Crowded as of this week** |
| **Productivity / notes** | Notes, Sensemaker, AI Second Brain, Thought Partner, TodoLens, Task Glance, LifePal | Capture and review notes and tasks | voice capture, tap complete | store listings | Medium |

---

## B. How G2 apps let people reply today — and what users say

### B1. The four reply patterns actually shipping

| Pattern | Who uses it | What it costs the user |
|---|---|---|
| **Preset quick replies** | Messages/Beeper (“preset responses”), Terminal Mode (“canned replies”), GlassChat (built-in presets + up to 10 custom), Telegram clients | zero effort, but says only what was pre-written |
| **Dictation** | Chesly (60 languages), VozGram (voice note or dictated text), GazeChat, Soveli Mail (word-for-word mode) | accurate but slow; you speak a whole message |
| **AI draft, then approve** | Soveli Mail (“speak the gist and let AI write the full reply in context… read back before it sends”); two hackathon builds (“AI draft approved by one tap”); Nod and Glance Brief (AI reply → Gmail draft) | fast, but the glasses can only show a short preview — you approve text you cannot really read |
| **Approval of an action** | Breakpoint (risk-ranked permission cards), TriageG2 (before→after diff, “Option 0 ALWAYS [ NO ]”, 1-tap undo), Hinty Agents (approve/deny across Claude Code, Codex, OpenClaw, Hermes) | safe, but the decision is binary and the reasoning is not yours |

### B2. What users appear to like

- **Ring-first control of long text** is the thing people praise: “Navigaze. My beloved!” and the IRIS quote sit in the
  catalogue’s own Discord strip (<https://hub.evenrealities.com/catalogue>).
- **Voice reply with a language auto-detect** is worth paying for: Chesly charges for voice replies, reported at
  **US$9.99/month** after a trial (<https://chesly.app/g2>, <https://www.reddit.com/r/EvenRealities/comments/1xpkwf8/>).
- **One-card-at-a-time triage** is being copied widely (Slack Lens, TriageG2, VozGram), which suggests it works.

### B3. What users complain about

| Complaint | Source |
|---|---|
| “Smart glasses, **stupid controls**” — ring control doesn’t work well in the real world | Engadget review, <https://www.engadget.com/2288658/even-realities-g2-smart-glasses-review/> |
| “Spectacular design. I just wish they actually **felt useful**.” | CNET, <https://www.cnet.com/tech/services-and-software/these-sleek-smart-glasses-get-so-much-right-why-am-i-so-disappointed/> |
| “Gesture navigation on the ring takes a while to get used to… tilt it inward toward your palm” | r/EvenRealities one-week review, <https://www.reddit.com/r/EvenRealities/comments/1vsszrp/> (snippet only; page blocked) |
| One app on screen at a time; no plugin notifications; bring your own speech-to-text | <https://dorahacks.io/hackathon/even-realities/detail> (“Know the limits”) |
| Apps that behave like a phone get deleted; dashboards don’t stick | <https://www.constella.app/blog/what-can-even-g2-do> |

**Read-across for us:** the friction is *input*, not reading. Every incumbent works around it with presets or AI drafts.
None of them lets a person say “this one line is wrong” and have that become the message.

---

## C. Is anyone doing point-anchored review of long AI output?

**Short answer: no, not in the store and not in the hackathon.**

| What I looked for | Result |
|---|---|
| Review of a long AI reply/plan, with feedback attached to a specific sentence | **Not found.** The shipping coding-agent apps read a **linear transcript** (“A long reply starts at its first line, so you read it from the top” — CodeAside) and offer approve/deny plus hold-to-talk. |
| Review of AI-written docs (Notion pages, Google Docs) from glasses | **Not found.** Notion apps browse, scroll, or search by voice; Docs Reader only displays. No app writes a comment back into the document. |
| Review of a Gmail draft from glasses | **Not found.** Soveli/Nod/Glance Brief *generate* a reply and save or send it; nothing lets you mark which sentence is wrong. |
| Approvals for coding agents | **Yes, and crowded.** Terminal Mode (first party), CodeAside, GlanceCode, G2C, Claude Code HUD, Breakpoint (“plans you want to judge before any code gets written”, risk-ranked, destructive commands need a 3-gesture confirm), Hinty Agents (free, cross-agent). |
| Nearest neighbour to our *interaction* | **Chengzhang** (hackathon build 51965): you talk, Claude writes an article, then the glasses show “a short list of things only you can decide, each settled with a tap or one spoken sentence”. Same primitive — decomposed decisions resolved by ring/voice — but applied to *your* text, with no quoted anchor and no review sent back to a worker. |

The gap is consistent across all four surfaces: **everyone shows text and asks yes/no; nobody collects “which line, and why”
and returns it as a structured artefact.**

---

## D. Rival hackathon builds, and how we must differ

113 public builds. Split: **Messaging & News 51 · Crypto & DeFi 34 · AI Assistants & Work 16 · Exchanges & Stocks 12**
(<https://dorahacks.io/hackathon/even-realities/build>).

### D1. The ones that overlap us

| Build | One line | Integrations | Why it is close |
|---|---|---|---|
| [TriageG2](https://dorahacks.io/build/51976) | “30-second hands-free Calendar, Gmail, Notion & AI executive HUD… pre-meeting 3-bullet briefs, safe Gmail drafts, Voice-to-Notion, Default-NO gate & 1-tap Undo” | Google Calendar, Gmail, Notion, OpenRouter/Claude | **Broadest scope overlap.** Its safety design (before→after diff, default NO, undo) is the strongest in the field |
| [Glance Brief](https://dorahacks.io/build/51795) | Meeting + unread inbox; “reply with one tap, saved as a Gmail draft, **never sent**” | Google Calendar, Gmail, Claude | Same “agent prepares, human approves” stance, one sentence at a time |
| [Nod](https://dorahacks.io/build/51725) | “Claude triages your Gmail… 3 ready replies, a Gmail draft in 3 taps”; claims precision 1.00 on a 50-email test | Claude, Gmail, Calendar | Direct rival for the email surface, with real numbers |
| [Chengzhang](https://dorahacks.io/build/51965) | Talk → Claude writes an article → “list of things only you can decide, each settled with a tap” | Claude | Closest to our *interaction*, furthest from our *object* |
| [Oh, Right!](https://dorahacks.io/build/51855) | Reminders, meeting prep, “sends Telegram replies you approve” | Calendar, Telegram | “Approve the reply” is the same promise, without per-point control |
| [TeleGlance](https://dorahacks.io/build/51943) | “VIP Telegram inbox, 30-second channel digest”, voice replies with an AI draft approved by one tap | Telegram | The Track 01 version of approve-a-draft |
| [EvenPulse](https://dorahacks.io/build/51982) | Telegram triage with P0/P1/P2 scoring and three AI-drafted replies (<https://github.com/akuraposo/even-pulse>) | Telegram | Best-executed Telegram entry; digests + drafts |

Also in the AI track: G2 Meeting Brief, FUSE Brief, Next Up, Kept (say a promise → Notion), Aside (Notion tasks),
JoatGlass, FixGuide AI. **Five or more are meeting-brief apps.** That cluster is closed.

### D2. What we must do to stand apart

1. **Show the anchor on the glasses.** Under each point, the exact quoted line it refers to. Rivals show a transcript
   you scroll; Chengzhang shows only the decision. The quote is our visible proof that nothing is invented.
2. **Return a composed review, not a verdict.** Numbered objections with quotes and reasons, sent to the agent as a
   reply it can act on. No competitor produces this artefact.
3. **Silence means agree.** Every rival needs a tap per item; ours lets an untouched list pass. That is the only way
   an 8-point plan is reviewable in 20 seconds — and it is what makes the ring viable at all.
4. **Never write the content we review.** This is the anti-slop position, stated on screen: Pinpoint is the correction
   layer, not a ghost-writer. We must say so out loud, because “AI drafts your reply” is now the default in this field.
5. **Name one user, not a category.** “Your coding agent’s plan, your Notion page, their email draft — reviewed line
   by line, from your glasses” beats “AI productivity HUD”.

Risk to manage: judges may read “review your agent” as developer-only. The Notion and email surfaces exist to prove it
is not.

---

## E. Recommendation

### E1. Which 2–3 integrations

| Priority | Integration | Why (evidence) | Guardrail |
|---|---|---|---|
| **1. Keep: coding agents (T3 / Claude)** | Our existing wedge | The category is crowded at approve/deny, but **empty at critique**. Breakpoint and CodeAside stop where we start. Judges score “read and write” 25%, and a quoted review is the write | Do not rebuild permission prompts (Terminal Mode owns it) |
| **2. Add: Notion page review** | Only 4 store apps, all browse/search/task; the API attaches a comment to a **specific block** (<https://developers.notion.com/reference/create-a-comment>); Notion is on Track 04’s live list | Points map 1:1 to blocks, so “the exact line” becomes literally true and the comment lands where the author will see it. **No AI drafting anywhere** |
| **3. Stretch: Gmail draft review** | “Clear your inbox in 30 seconds” is Track 04’s own example, but at least three entrants already draft-and-save | Only review a draft that **already exists** (written by the agent or by you); never compose from a blank page |
| **Skip: calendar browsing, meeting briefs, Telegram digests** | 15 calendar apps; 5+ meeting-brief builds this week; 51 messaging builds | Use the calendar **read-only as context** (“who is in this thread”) and Telegram as transport, not as the pitch |

### E2. Reply pattern per surface

| Surface | Pattern | Reason |
|---|---|---|
| Agent plan / report | **Revise per your words**: tap → objection + short reason → deterministic composed review; untouched = agree | The artefact is a decision, not a message; this is the only pattern that survives an 8-point plan |
| Agent question | **Yes/no options, recommended first**, plus “say something else” | Matches Terminal Mode’s proven shape and Even’s “Yes / No” example |
| Notion page | **Per-block comment** (tap, speak, tap) | API supports block anchoring; the author sees it in context |
| Gmail draft | **Annotate then regenerate** — never raw generation on the glasses | Avoids the slop the owner rejects: the draft already carries context; our value is the correction |
| Telegram message | **Templates for acknowledgements, dictation for short, quoted note for long threads** | Typing is the bottleneck (presets everywhere); quote-replies keep the thread readable |
| Meeting prep | **Consume, do not build** | Crowded, and IRIS already owns it |

---

## Not found / not verifiable

- **Per-app install counts, ratings or review text** — the store API exposes none (`/detail` fields: package_id, name,
  creator_name, tagline, description, icon, background, foreground, category, tags, version). Traction is therefore
  judged only by editor’s-choice and trending placement.
- **Discord and Reddit sentiment at scale** — Reddit rejects scripted access (403); Discord is not public.
  Quotes used here come from the catalogue’s own Discord strip and press reviews.
- **The 2 private builds** on the Builds tab — invisible by design.
- **GlassMail** (previously described as an AI Gmail app) is not returned by store search today; treat as
  unavailable rather than confirmed delisted.

## Sources

- Even Hub catalogue — <https://hub.evenrealities.com/catalogue>; storefront API
  (`/api/v1/storefront/discovery`, `/list` total 1,148, `/detail`, `/search`), read 27 Nov 2026.
- App pages cited inline: `com.akelu.ocuclaw`, `solutions.pleiades.evenmessages`, `com.irispublic.assistant`,
  `io.github.gwro.codeaside`, `dev.glancecode.glasses`, `com.liyiyuian.tmuxor`, `com.viceversawine.gmailalerts`,
  `net.lensmail.g2`, `com.leevonabuan.notiontalk`, `com.okazakitomoki.slacklens`, `com.castech.vozgram2`,
  `com.kickstartcrew.relaysight`, `com.github.builtproper.gazechat`, `it.minimac.agendag2`.
- Heads Up hackathon — <https://dorahacks.io/hackathon/even-realities/detail> (rules, tracks, judging),
  <https://dorahacks.io/hackathon/even-realities/build> (113 public builds, 27 Nov 2026).
- Individual builds: 51976 TriageG2 · 51795 Glance Brief · 51725 Nod · 51965 Chengzhang · 51855 Oh, Right! ·
  51964 GlanceBrief · 51906 Next Up · 51663 FUSE Brief.
- GitHub — <https://github.com/pangoleen/awesome-even-realities-g2>;
  repos `Sammy949/breakpoint`, `hinty-eu/hinty-agents`, `bck-stack/closer`, `akuraposo/even-pulse`,
  `Class-now/nod-g2`, `Khazmi-lab/glance-brief`, `jinan86/even-realities-glancenotes`.
- Press — <https://www.engadget.com/2288658/even-realities-g2-smart-glasses-review/>,
  <https://www.cnet.com/tech/services-and-software/these-sleek-smart-glasses-get-so-much-right-why-am-i-so-disappointed/>,
  <https://chesly.app/g2>, <https://www.constella.app/blog/what-can-even-g2-do>.
- APIs we would build on — <https://developers.notion.com/reference/create-a-comment> (block-level comments),
  <https://developers.google.com/gmail/api/reference/rest/v1/users.drafts> (drafts).
- Local notes — `research/03-even-g2-platform-and-hub-apps.md`, `research/05-hackathon-rules-and-competition.md`
  (platform limits, earlier store baseline).
