# Submit checklist (for the owner)

Organizers' deadline: **Nov 29 23:59 Dubai = Nov 30 04:59 JST**. Demo Day is Dec 3. Submit a day early if you can. Paste-ready text for every field is in [SUBMISSION.md](SUBMISSION.md). This list replaces the old `MORNING.md`.

## 0. Before you open DoraHacks (10 minutes)

- [ ] **Final video is uploaded.** Put it at `apps/site/media/pinpoint-demo.mp4` (the site plays `media/pinpoint-demo.mp4`) and attach the same file to the GitHub release. Open both links in a private window; both must play without a login.
- [ ] **Fill the placeholders.** Run `grep -rn "RELEASE_URL\|VIDEO_URL\|TODO(lead)" README.md docs/ | grep -v "exec-plans\|SUBMIT-CHECKLIST"` and resolve every hit. Public files must not contain `TODO(lead)` when you submit.
- [ ] **The site works.** https://pinpoint.qolso.com opens in a private window; the simulator starts; the privacy page (from [privacy.md](privacy.md)) is linked in the footer; `/app/` shows the glasses app.
- [ ] **The cloud is up.** `curl https://pinpoint-api.qolso.com/api/health` returns `"ok":true,"mode":"cloud"`. If it fails, tell the lead before anything else; the sample workspace is the first thing a judge touches.
- [ ] **CORS check** (from [device-readiness.md](device-readiness.md) §1.3):
  ```sh
  curl -i -X OPTIONS https://pinpoint-api.qolso.com/api/inbox -H 'Origin: null' \
    -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: x-pinpoint-device'
  ```
  Expect `access-control-allow-origin: *` and `x-pinpoint-device` in the allowed headers.
- [ ] **Repo is public**, README renders, no secrets: `git log -p | grep -i "token\|secret"` finds nothing real, `apps/server/.env` is not tracked.
- [ ] **Checks pass:** `npm run check`. Note the final test counts for the form.
- [ ] **Package is current:** `npm --prefix apps/glasses run pack`; confirm `apps/glasses/pinpoint.ehpk` is newer than the last glasses change and attach it to the release.

## 1. Discord eligibility post (1 minute)

Post in the hackathon Discord, in the channel for rules or eligibility questions:

> Hi, could you confirm eligibility for our Heads Up submission, Pinpoint? It is a G2 app that works as an attention layer for AI agents: it shows what needs you, sorts long output to the decisions, and sends your voice corrections to where the work lives. The integrations are Notion (a comment on the exact block), Gmail (the draft sentence edited in place), Telegram (topics and quote-replies), and T3 Code, an open-source harness that runs Codex and Claude Code. The AI Assistants & Work track lists Notion and Google Workspace, so we are entering that track, plus Messaging & News as the second track and Best Telegram integration. The app is tested in the official simulator, and it also runs on a sample workspace in the browser at https://pinpoint.qolso.com. Please tell us if anything about the integrations needs to change.

## 2. DoraHacks BUIDL form (10 minutes)

1. Open https://dorahacks.io/hackathon/even-realities/detail → **Submit BUIDL** (or **Edit BUIDL** if a draft exists).
2. Go field by field through [SUBMISSION.md](SUBMISSION.md) in the same order:
   - Name, tagline, short description (stay at 300 words or fewer).
   - Tracks: **AI Assistants & Work** (main), **Messaging & News** (second). Add **Best Telegram integration** wherever the special prizes are listed, and paste the "Special prize note".
   - Demo video URL, repository, website.
   - How to test, team, prior work, feature requests (5, in the short form).
   - Logo, cover image, 4 to 5 screenshots.
3. Attach `pinpoint.ehpk` if the form has an attachment field.
4. Click **Save**, reopen the page in a private window, and check that the video plays and the links open.
5. Press **Submit**. Confirm the BUIDL shows as *Submitted*, not *Draft*.

| Link to use | URL |
|---|---|
| Site | https://pinpoint.qolso.com |
| Repo | https://github.com/sonozaki7/pinpoint |
| Video | VIDEO_URL (same file as https://pinpoint.qolso.com/media/pinpoint-demo.mp4) |
| Release (video + `.ehpk`) | RELEASE_URL |
| Glasses app QR | https://pinpoint.qolso.com/app/ |
| Cloud API (health) | https://pinpoint-api.qolso.com/api/health |

## 3. Even developer portal: upload a beta build (15 to 20 minutes, optional but recommended)

The reason: a beta build is the only install that **survives a locked phone** and appears on the glasses menu. A QR sideload stops when the phone locks ([device-readiness.md](device-readiness.md) §2). Store review has no published turnaround, so do not wait on it. Menu names below come from Even's docs ([Testing Modes](https://hub.evenrealities.com/docs/test/), [App Submission](https://hub.evenrealities.com/docs/ship/app-submission)); confirm the current labels while you click.

1. Sign in at https://hub.evenrealities.com/login with the **same email** as your Even Realities phone app. Force-quit and reopen the phone app so the developer section appears.
2. Rebuild the package: `npm --prefix apps/glasses run pack`. Check `apps/glasses/app.json` first: `package_id` `com.sonozaki7.pinpoint`, `version` 1.1.0 (a new upload needs a higher version), name `Pinpoint` (20 characters or fewer, no "Even").
3. In the portal, create the app (or use `evenhub create` from `apps/glasses`) with:
   - Name `Pinpoint`; tagline (50 characters or fewer): `Your AI agents' attention layer`
   - Description (up to 2,000 characters): paste the short description from SUBMISSION.md.
   - Icon: `apps/glasses/icon-24.png` (exactly 24×24, one color).
   - Screenshots: simulator captures from `demo/shots/` at 576×288.
   - Privacy policy: link the privacy page and name the backend domain `pinpoint-api.qolso.com`.
4. Upload `apps/glasses/pinpoint.ehpk`. Mark the build **Beta** (the build must be tagged Beta *and* a tester must be Active, or the phone says "test version expired").
5. Add testers by their Even account email. Each tester accepts the invitation email within 7 days; their status must read **Active**.
6. On a tester's phone: Even Realities app → **Me → Beta tester → Pinpoint → Install**. It then appears on the glasses menu.
7. Share the install steps and the Even app version requirement (2.2.10 or newer) in the form's "How to test".

Do **not** press Publish unless you want the public store review. It cannot be rolled back; published versions are fix-forward only.

## 4. After you submit

- [ ] Re-open the submitted BUIDL and check the video, the repo and the site once more from a phone on mobile data.
- [ ] Keep the cloud running until judging ends. If you redeploy, the sample workspaces reset (by design) and desk pairings need new codes.
- [ ] Keep a charged phone with the simulator page open for Demo Day in case the Wi-Fi is poor.
- [ ] Do not change the repo's default branch or force-push before judging ends.
