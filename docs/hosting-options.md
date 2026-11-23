# Hosting options for the Pinpoint landing page

Researched 2026-11-24 (read-only). Goal: publish a few static files (HTML/CSS/JS)
plus the demo video (`mp4`) on one of the owner's existing domains or hosting
setups, without touching any live production site.

Everything below was checked on this Mac on 2026-11-24. No DNS record, config,
deploy, or login was created or changed.

## What the site needs to serve

| Thing | Size reality |
|---|---|
| `index.html`, CSS, JS, images | ~1–5 MB |
| `pinpoint-demo.mp4` (about 2:40, 1080p, h264) | Reference point: the earlier Agent Relay concept film rendered by the same Remotion project at CRF 17 is **27 MB** (landscape). Expect roughly 25–60 MB. |
| HTTPS, a URL a judge can open | Required |

The video size is the deciding constraint, because two popular hosts cap a
single file well below it (details in the table).

## Environment facts found (2026-11-24)

- **Domains on Cloudflare**: `qolso.com`, `tatpi.com`, `taviaverify.com`,
  `jennielove.com`, `getnightforge.com` all use the same Cloudflare nameservers
  (`christina` / `giancarlo`). DNS for these zones is therefore edited in the
  Cloudflare dashboard, not at a registrar.
- **Wildcard exists on `qolso.com`**: a made-up subdomain
  (`asdfqwer1234zz.qolso.com`) resolves through Cloudflare and returns HTTP 521
  (no origin). So *any* new qolso subdomain today shows a Cloudflare error page.
  A specific record for one subdomain overrides the wildcard and does not
  change `qolso.com`, `www`, `huxsy`, or `crm`.
- **Signed in on this Mac**:
  - GitHub CLI — account `sonozaki7`, keyboard-chain token, scopes include
    `repo` and `workflow` (so it can create a repo and push a workflow file).
  - GitLab CLI — account `sonozaki`.
  - Fly.io CLI — account `sou.nozaki@gmail.com`.
  - `cloudflared` is installed but has **no origin certificate**, so no tunnel
    exists and `cloudflared tunnel list` fails. Tunnels are not available
    without a browser login.
- **Not installed / not signed in**: `wrangler`, `vercel`, `netlify`,
  `firebase`, `surge`. No `~/.config/.wrangler` OAuth cache. No
  `CLOUDFLARE_*`, `VERCEL_*`, or `NETLIFY_*` token in the environment or shell
  profiles. Cloudflare/Vercel/Netlify all need a fresh `npx … login` (a browser
  click by the owner) or a scoped API token.
- **Existing hosting patterns** (read from each project's config):
  - `qolso.com` — plain static files on the `new-prod` VPS under
    `/var/www/qolso.com`, deployed by a forced-command script from GitLab CI.
  - `huxsy.qolso.com` — Cloudflare Worker with static assets, deployed by
    `pnpm exec wrangler deploy --env production` from GitLab CI (Cloudflare
    credentials live in GitLab CI variables).
  - `tatpi.com`, `crm.qolso.com` — new-prod VPS.
  - `portfolio` — GitHub Pages project site at
    `https://sonozaki7.github.io/portfolio/` (legacy builder, `gh-pages`
    branch, no custom domain), deployed by a GitHub Actions workflow.
  - `sonozaki7/pinpoint` does **not** exist on GitHub yet; the local repo has no
    remote.
- **Host limits that matter here** (vendor docs, checked 2026-11-24):
  - GitHub Pages: 1 GB published site, 100 GB/month soft bandwidth, and GitHub
    rejects any single file over 100 MB (warning above 50 MB). Free for public
    repositories.
  - Cloudflare Pages: **25 MiB maximum for a single file**; larger files must go
    to R2 with a public bucket or a custom domain.

## Options table

| # | Domain / subdomain | Hosting mechanism | Exact deploy commands | DNS changes | Reversibility | Risk to existing production | Time to live |
|---|---|---|---|---|---|---|---|
| 1 **GitHub Pages, project path** — `https://sonozaki7.github.io/pinpoint/` | New public GitHub repo `sonozaki7/pinpoint`, Actions workflow uploads `apps/site` | `cd /Users/so/Desktop/Project/pinpoint`<br>`gh repo create sonozaki7/pinpoint --public --source=. --remote=origin --push`<br>`gh api -X POST repos/sonozaki7/pinpoint/pages -f build_type=workflow`<br>then push the workflow (below) | **None** | Delete the repo (or `gh api -X DELETE repos/sonozaki7/pinpoint/pages`) — nothing else is touched | **None.** New repo, new Pages site, no shared config, no DNS | 5–10 min |
| 2 GitHub Pages + `pinpoint.qolso.com` | Same as #1, plus GitHub custom domain | Same as #1, then `echo pinpoint.qolso.com > apps/site/CNAME`<br>`gh api -X PUT repos/sonozaki7/pinpoint/pages -f cname=pinpoint.qolso.com -F https_enforced=true` | One **new** `CNAME pinpoint → sonozaki7.github.io`, **Proxy status: DNS only**. GitHub may also ask for one `_github-pages-challenge-…` TXT record. | Remove the custom domain (API DELETE) + delete the two records; wildcard returns to its current 521 behaviour | **Additive only.** No existing record edited; `qolso.com`, `www`, `huxsy`, `crm` untouched | 15–40 min (includes Let's Encrypt certificate) |
| 3 Cloudflare Pages, new project | `npx wrangler pages deploy` (or dashboard upload) | `npx wrangler login` (owner click)<br>`npx wrangler pages project create pinpoint-landing --production-branch=main`<br>`npx wrangler pages deploy apps/site --project-name=pinpoint-landing` | Optional: add `pinpoint.qolso.com` as a Pages custom domain (Cloudflare usually writes the record itself) | Delete the Pages project; remove the custom domain/record | **None** to existing Workers, but **the 25 MiB file cap blocks the mp4** unless it is under 25 MB or moved to R2 | 10–20 min (+15 min if R2 for video) |
| 4 Vercel, new project | `npx vercel` static deploy | `npx vercel login` (owner click)<br>`npx vercel --prod --cwd apps/site` | Optional `pinpoint.qolso.com` via `npx vercel domains add` | `npx vercel remove pinpoint` | None (separate project/account) | 10–20 min |
| 5 Netlify, new project | `npx netlify deploy` | `npx netlify login` (owner click)<br>`npx netlify deploy --prod --dir=apps/site` | Optional custom domain | Delete the site in the dashboard | None | 10–20 min |
| 6 GitLab Pages | `sonozaki` GitLab project + Pages job | Create project, add `.gitlab-ci.yml` `pages:` job publishing `apps/site` as `public/` | Optional `pinpoint` subdomain on `*.gitlab.io` | Delete the project | None, but duplicates the repo that must live on GitHub for submission | 15–25 min |
| 7 Fly.io container | `flyctl` (already signed in) + Dockerfile with nginx | `flyctl launch --no-deploy` … `flyctl deploy` | Optional | `flyctl apps destroy` | None, but needs a payment method and is **not free**; overkill for static files | 45–90 min |
| 8 Existing VPS static path (`qolso.com`, `tatpi.com`) | Copy files into `/var/www/...` on `new-prod` | SSH deploy | None | Delete the files | **High — edits the live production host and its deploy layout.** Rejected | 10 min but wrong risk |
| 9 `cloudflared` quick tunnel | Tunnel from this Mac | `cloudflared tunnel --url http://localhost:8080` | None (random URL) | Ctrl-C | None, but the Mac must stay awake and the URL is random/temporary. Rejected for a judged submission | 2 min, unreliable |

## Recommendation

**Option 1 now, with Option 2 as an optional 10-minute upgrade: a new public
GitHub repository `sonozaki7/pinpoint` served by GitHub Pages.**

Why this one:

- **Nothing existing is modified.** No production config, no deploy pipeline, no
  shared Worker, no Cloudflare CI variable, no DNS record in phase 1.
- **Already authorised and fast.** The GitHub CLI is signed in with the scopes
  needed; the portfolio already proves the same Pages pattern works on this
  account. No new account, no OAuth click, no payment method.
- **The video fits.** GitHub allows up to 100 MB per file; Cloudflare Pages
  (25 MiB per file) would force a re-encode or an R2 bucket.
- **The repository has to be public for the hackathon submission anyway**, so
  Pages costs nothing extra.

### What would be created or changed (Option 1)

1. New public GitHub repository `sonozaki7/pinpoint`, pushed from the existing
   local folder (same history, no rewrite).
2. Pages enabled for that repository with source "GitHub Actions" (one API
   call, or one dashboard toggle).
3. One new workflow file in that repository that uploads `apps/site` to Pages.
4. New URL: `https://sonozaki7.github.io/pinpoint/`.

Suggested workflow (file: `.github/workflows/pages.yml`):

```yaml
name: Deploy landing page
on:
  push:
    branches: [main]
    paths: ["apps/site/**"]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: apps/site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Site-side rules for a project path:

- Use **relative** asset URLs (`./styles.css`, `./pinpoint-demo.mp4`), or prefix
  with `/pinpoint/`. Absolute `/styles.css` will 404 under the project path.
- Put the video in `apps/site/` and keep it under ~90 MB. If the final render is
  bigger, re-render at CRF 20–23 first; only then consider a separate video host.

Verify after the first run: `curl -sI https://sonozaki7.github.io/pinpoint/`
expects `200`, and the page plus video load in a private window.

### Optional upgrade: `https://pinpoint.qolso.com`

Only if a branded URL matters to the judge-facing pitch. It adds one DNS
record and one repository setting, both reversible:

1. Cloudflare → `qolso.com` zone → DNS → Add record: type `CNAME`, name
   `pinpoint`, target `sonozaki7.github.io`, **Proxy status: DNS only**.
   (The existing `*.qolso.com` wildcard is proxied and currently returns 521;
   this specific record overrides it for this one name. Do not set the orange
   cloud — proxying GitHub Pages adds certificate/redirect complexity.)
2. `echo pinpoint.qolso.com > apps/site/CNAME` and push.
3. `gh api -X PUT repos/sonozaki7/pinpoint/pages -f cname=pinpoint.qolso.com -F https_enforced=true`
4. If GitHub asks for domain verification, add the single
   `_github-pages-challenge-sonozaki7.pinpoint` TXT record it shows.
5. Wait for the certificate (usually minutes, worst case about an hour).

### How to undo everything

| Step | Undo |
|---|---|
| Phase 1 site | `gh api -X DELETE repos/sonozaki7/pinpoint/pages` (or delete the repo) |
| Phase 2 custom domain | Same API DELETE (removes the domain from Pages), then delete the `pinpoint` CNAME and the challenge TXT record in Cloudflare |
| Video/site files | They live in the repo; deleting the repo removes them |

No production site, deploy script, Worker, or CI pipeline is touched at any
step, so there is nothing to roll back anywhere else.

## Checks I deliberately did not run

- No DNS record created, edited, or deleted (only `dig`/`curl` reads).
- No `wrangler`, `vercel`, `netlify`, or `cloudflared` login (would open a
  browser window and create credentials).
- No repo created, no push, no deploy.
- No secret printed; token checks reported only presence/absence.
