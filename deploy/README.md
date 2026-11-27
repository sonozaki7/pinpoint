# Pinpoint Cloud deployment

`https://pinpoint-api.qolso.com` → your own Linux server (SSH alias in `PINPOINT_DEPLOY_HOST`) behind Cloudflare.
The container listens on `127.0.0.1:4390`; nginx terminates TLS and proxies to it.

## What lives where

| Where | What |
|---|---|
| `$PINPOINT_DEPLOY_HOST:/srv/apps/pinpoint-cloud` | synced copy of this repo (apps/server, shared, demo/fixtures, demo/sample, deploy) |
| `$PINPOINT_DEPLOY_HOST:/etc/nginx/sites-available/pinpoint-api.qolso.com` | nginx site (HTTP→HTTPS, ACME webroot, WebSocket proxy) |
| `$PINPOINT_DEPLOY_HOST:/etc/nginx/sites-enabled/pinpoint-api.qolso.com` | symlink that enables the site |
| `$PINPOINT_DEPLOY_HOST:/var/www/pinpoint-api-acme` | certbot webroot |
| `$PINPOINT_DEPLOY_HOST:/etc/letsencrypt/live/pinpoint-api.qolso.com` | certificate |
| Cloudflare zone `qolso.com` | proxied A record `pinpoint-api` → `<your server IP>` |
| Docker | compose project `pinpoint-cloud`, container `pinpoint-cloud`, volume `pinpoint-cloud_pinpoint-data` mounted at `/data` |

The image bakes whisper.cpp `v1.9.6` and `ggml-base.en.bin` (pinned commit, sha256
checked at build). Runtime is Node 22 slim, non-root uid 10001, read-only root
filesystem with a `/tmp` tmpfs and the `/data` volume. Cloud mode needs no secrets; one optional
secret (a DeepSeek key) turns on model-phrased Ask answers, see below.

## Deploy

```bash
./deploy/deploy.sh                 # build + recreate + wait for health
PINPOINT_MODE=demo ./deploy/deploy.sh   # first check before cloud mode landed
PINPOINT_SKIP_BUILD=1 ./deploy/deploy.sh  # reuse the last image
```

The script syncs only what the image needs (no `node_modules`, `.data`, env
files), appends one audit line on the server if `PINPOINT_AUDIT_LOG` is set, runs
`docker compose -p pinpoint-cloud -f deploy/compose.yml up -d --build` on the
server, then polls `https://pinpoint-api.qolso.com/api/health` (falls back to the
SSH loopback for the first deploy, before DNS existed).

## Optional: DeepSeek key for Ask (server-only secrets file)

Without a key, Ask in the cloud answers with the exact source sentence (retrieval, no model). With a key,
DeepSeek (`deepseek-flash`) may choose among the top three retrieved sentences and phrase a short answer.
The quote is always an exact sentence; a phrasing that adds a number or name is rejected. Limits: 20 model
answers per device per minute, then a daily cap across all devices (default 2000, `PINPOINT_ASK_DAILY_CAP`);
past either one Ask still answers with the exact sentence. Cloud never reads any other secret.

The file lives outside the synced repo copy's tracked files and is never uploaded by `deploy.sh`
(it syncs with `tar`, no delete, and skips `.env*`). One-time, by the lead:

```bash
ssh $PINPOINT_DEPLOY_HOST 'sudo install -m 600 -o root -g root /dev/null /srv/apps/pinpoint-cloud/secrets.env'
# put the key in without echoing it, e.g. from your own machine's apps/server/.env:
grep '^DEEPSEEK_API_KEY=' apps/server/.env | ssh $PINPOINT_DEPLOY_HOST 'sudo tee /srv/apps/pinpoint-cloud/secrets.env >/dev/null'
# optional cap: echo 'PINPOINT_ASK_DAILY_CAP=2000' | ssh ... 'sudo tee -a /srv/apps/pinpoint-cloud/secrets.env'
./deploy/deploy.sh                       # compose reads the file when it recreates the container
ssh $PINPOINT_DEPLOY_HOST 'docker logs pinpoint-cloud 2>&1 | grep "ask="'   # ask=deepseek:deepseek-flash cap 2000/day
```

`secrets.env` is `KEY=value` lines (Compose `env_file`, needs Compose 2.24+; the entry is `required: false`, so
deploys work without it). To rotate or remove the key, edit or delete the file and run `deploy.sh` again.
Do not print the file or put the key in a command line.

## Enable HTTPS (once, after DNS)

Create the proxied Cloudflare A record `pinpoint-api` → `<your server IP>` in zone
`qolso.com`, wait for it to resolve, then:

```bash
./deploy/setup-https.sh
```

It runs the webroot certificate request for this one domain, enables the staged
nginx site, reloads nginx gracefully, and checks the public health endpoint.
Renewal uses the server's existing certbot timer.

## Logs

```bash
ssh $PINPOINT_DEPLOY_HOST 'docker logs --tail 100 -f pinpoint-cloud'
ssh $PINPOINT_DEPLOY_HOST 'docker stats --no-stream pinpoint-cloud'
ssh $PINPOINT_DEPLOY_HOST 'sudo tail -n 50 /var/log/nginx/pinpoint-api.access.log'
ssh $PINPOINT_DEPLOY_HOST 'sudo tail -n 50 /var/log/nginx/pinpoint-api.error.log'
```

## Roll back

```bash
# 1. stop and remove the container + its private volume
ssh $PINPOINT_DEPLOY_HOST 'docker compose -p pinpoint-cloud -f /srv/apps/pinpoint-cloud/deploy/compose.yml down -v'
ssh $PINPOINT_DEPLOY_HOST 'sudo rm -rf /srv/apps/pinpoint-cloud'

# 2. disable and remove the nginx site, then reload gracefully
ssh $PINPOINT_DEPLOY_HOST 'sudo rm /etc/nginx/sites-enabled/pinpoint-api.qolso.com'
ssh $PINPOINT_DEPLOY_HOST 'sudo rm /etc/nginx/sites-available/pinpoint-api.qolso.com'
ssh $PINPOINT_DEPLOY_HOST 'sudo nginx -t && sudo systemctl reload nginx'
ssh $PINPOINT_DEPLOY_HOST 'sudo rm -rf /var/www/pinpoint-api-acme'

# 3. delete the certificate
ssh $PINPOINT_DEPLOY_HOST 'sudo certbot delete --cert-name pinpoint-api.qolso.com'

# 4. delete the Cloudflare DNS record (zone qolso.com)
#    Dashboard: DNS → pinpoint-api → Delete. Or API:
#    curl -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
#      -H "Authorization: Bearer $CF_API_TOKEN"
```

Do not remove or reload anything else: the other sites, certificates and
containers on this server belong to different products.

## Certificate

One-time, after the DNS record resolves to this server:

```bash
ssh $PINPOINT_DEPLOY_HOST 'sudo mkdir -p /var/www/pinpoint-api-acme'
ssh $PINPOINT_DEPLOY_HOST 'sudo certbot certonly --webroot -w /var/www/pinpoint-api-acme -d pinpoint-api.qolso.com'
ssh $PINPOINT_DEPLOY_HOST 'sudo ln -s /etc/nginx/sites-available/pinpoint-api.qolso.com /etc/nginx/sites-enabled/pinpoint-api.qolso.com'
ssh $PINPOINT_DEPLOY_HOST 'sudo nginx -t && sudo systemctl reload nginx'
```

Renewal is handled by the server's existing certbot timer; no extra setup.
