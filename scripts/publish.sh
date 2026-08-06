#!/usr/bin/env bash
# Publish DerteApp to a Hostinger VPS (or any Debian/Ubuntu box with Docker).
#
# Required env (or Cursor secrets):
#   DEPLOY_HOST          e.g. 123.45.67.89 or app.tudominio.com
#   DEPLOY_USER          e.g. root
#   DEPLOY_SSH_KEY       path to private key (default: ~/.ssh/derteapp_deploy)
#   APP_URL              e.g. https://app.tudominio.com
#   CADDY_DOMAIN         e.g. app.tudominio.com  (optional; enables HTTPS proxy)
#   SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD / SUPER_ADMIN_PHONE
#   JWT_SECRET / POSTGRES_PASSWORD
#
# Usage:
#   ./scripts/publish.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_HOST="${DEPLOY_HOST:?Set DEPLOY_HOST (VPS IP or hostname)}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/derteapp_deploy}"
REMOTE_DIR="${REMOTE_DIR:-/opt/derteapp}"
APP_URL="${APP_URL:?Set APP_URL (public https origin)}"
CADDY_DOMAIN="${CADDY_DOMAIN:-}"

need() { [[ -n "${!1:-}" ]] || { echo "Missing $1"; exit 1; }; }
need JWT_SECRET
need POSTGRES_PASSWORD
need SUPER_ADMIN_EMAIL
need SUPER_ADMIN_PASSWORD
need SUPER_ADMIN_PHONE

if [[ ! -f "$DEPLOY_SSH_KEY" ]]; then
  echo "SSH key not found: $DEPLOY_SSH_KEY"
  exit 1
fi

SSH=(ssh -i "$DEPLOY_SSH_KEY" -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}")
RSYNC=(rsync -az --delete
  --exclude node_modules
  --exclude .git
  --exclude .env
  --exclude .env.*
  --exclude tmp
  --exclude coverage
  -e "ssh -i ${DEPLOY_SSH_KEY} -o StrictHostKeyChecking=accept-new")

echo "==> Ensuring Docker on ${DEPLOY_HOST}"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null
mkdir -p /opt/derteapp
REMOTE

echo "==> Syncing source to ${REMOTE_DIR}"
"${RSYNC[@]}" ./ "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/"

echo "==> Writing production env"
# shellcheck disable=SC2087
"${SSH[@]}" "cat > ${REMOTE_DIR}/.env.production" <<EOF
APP_URL=${APP_URL}
APP_NAME=${APP_NAME:-DerteApp}
CADDY_DOMAIN=${CADDY_DOMAIN}
HOST_PORT=${HOST_PORT:-3000}
POSTGRES_DB=${POSTGRES_DB:-derteapp}
POSTGRES_USER=${POSTGRES_USER:-derte}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-30d}
CORS_ORIGINS=${CORS_ORIGINS:-}
OTP_DEBUG=false
ALLOW_SELF_REGISTRATION=${ALLOW_SELF_REGISTRATION:-false}
SUPER_ADMIN_EMAIL=${SUPER_ADMIN_EMAIL}
SUPER_ADMIN_PHONE=${SUPER_ADMIN_PHONE}
SUPER_ADMIN_PASSWORD=${SUPER_ADMIN_PASSWORD}
SUPER_ADMIN_NAME=${SUPER_ADMIN_NAME:-Super Admin}
DEFAULT_TIMEZONE=${DEFAULT_TIMEZONE:-Europe/Madrid}
ZADARMA_KEY=${ZADARMA_KEY:-}
ZADARMA_SECRET=${ZADARMA_SECRET:-}
ZADARMA_DEFAULT_SIP=${ZADARMA_DEFAULT_SIP:-}
ZADARMA_VERIFY_WEBHOOKS=${ZADARMA_VERIFY_WEBHOOKS:-true}
RETELL_API_KEY=${RETELL_API_KEY:-}
RETELL_WEBHOOK_SECRET=${RETELL_WEBHOOK_SECRET:-}
RETELL_VERIFY_WEBHOOKS=${RETELL_VERIFY_WEBHOOKS:-true}
RETELL_DEFAULT_SHOP_ID=${RETELL_DEFAULT_SHOP_ID:-}
EOF

PROFILES=()
if [[ -n "$CADDY_DOMAIN" ]]; then
  PROFILES+=(--profile proxy)
fi

echo "==> Building and starting"
"${SSH[@]}" "cd ${REMOTE_DIR} && docker compose --env-file .env.production ${PROFILES[*]:-} up -d --build"

echo "==> Seeding Super Admin"
"${SSH[@]}" "cd ${REMOTE_DIR} && docker compose --env-file .env.production exec -T app npm run seed"

echo "==> Health check"
if [[ -n "$CADDY_DOMAIN" ]]; then
  HEALTH_URL="https://${CADDY_DOMAIN}/api/health"
else
  HEALTH_URL="${APP_URL%/}/api/health"
fi
sleep 3
curl -fsS "$HEALTH_URL" | head -c 400 || true
echo
echo "Published: ${APP_URL}"
echo "Super Admin login: email ${SUPER_ADMIN_EMAIL}"
if [[ -n "$CADDY_DOMAIN" ]]; then
  echo "Retell webhook: ${APP_URL%/}/api/webhooks/retell"
  echo "Zadarma webhook: ${APP_URL%/}/api/telephony/webhooks/zadarma"
fi
