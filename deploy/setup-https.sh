#!/usr/bin/env bash
# One-time HTTPS enablement for pinpoint-api.qolso.com.
#
# Run this ONLY after the Cloudflare A record `pinpoint-api` -> <your server IP>
# (proxied) exists and HTTP requests reach this server's nginx.
# It issues the certificate through the ACME webroot, enables the site that
# deploy/deploy.sh already staged, and verifies the public endpoint.
set -euo pipefail

HOST="${PINPOINT_DEPLOY_HOST:?set PINPOINT_DEPLOY_HOST to the SSH alias of your server}"
DOMAIN="pinpoint-api.qolso.com"
EMAIL="${PINPOINT_ACME_EMAIL:-}"

if [ -z "$(dig +short "$DOMAIN" A)" ]; then
  echo "DNS for $DOMAIN does not resolve yet; add the Cloudflare A record first." >&2
  exit 1
fi

ssh "$HOST" "set -e
  sudo install -d -m 755 /var/www/pinpoint-api-acme
  sudo certbot certonly --webroot -w /var/www/pinpoint-api-acme -d '${DOMAIN}' \
    --non-interactive --agree-tos --keep-until-expiring ${EMAIL:+--email '${EMAIL}'}
  sudo ln -sfn /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
  sudo nginx -t
  sudo systemctl reload nginx
"

echo "waiting for the public endpoint"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://${DOMAIN}/api/health"; then
    echo
    exit 0
  fi
  sleep 3
done
echo "certificate installed but the public health check failed" >&2
exit 1
