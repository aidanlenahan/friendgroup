#!/usr/bin/env bash
# Deploy current branch to production.
# Prod runs at gem.aidanlenahan.com / api-gem.aidanlenahan.com
# Reads config from /etc/gem/gem-api.env
set -euo pipefail

PROD_ENV_FILE="/etc/gem/gem-api.env"
PROD_API_URL="https://api-gem.aidanlenahan.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "==> $*"; }

# ── 1. Verify env file exists ────────────────────────────────────────────────
if [[ ! -f "$PROD_ENV_FILE" ]]; then
  echo "ERROR: $PROD_ENV_FILE not found."
  exit 1
fi

# ── 2. Confirm ───────────────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  Deploying to PRODUCTION                │"
echo "  │  gem.aidanlenahan.com                   │"
echo "  └─────────────────────────────────────────┘"
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ "${confirm,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

# ── 3. Set up email notifications (captures all subsequent output) ───────────
# shellcheck source=notify.sh
source "$SCRIPT_DIR/notify.sh"
setup_notifications "$PROD_ENV_FILE" "Deploy -> Production (${PROD_API_URL})"

# ── 4. Enable full command tracing ───────────────────────────────────────────
set -x

# ── 5. Print system context ───────────────────────────────────────────────────
log "System context"
date
uname -a
whoami
pwd
node --version 2>/dev/null || true
npm  --version 2>/dev/null || true
git  log --oneline -5

# ── 6. Install dependencies ──────────────────────────────────────────────────
log "Installing dependencies"
npm install

# ── 7. Build API ─────────────────────────────────────────────────────────────
log "Building API"
npm run build:api

# ── 8. Build web with prod API URL ───────────────────────────────────────────
log "Building web (targeting $PROD_API_URL)"
VITE_API_BASE_URL="$PROD_API_URL" \
  VITE_SOCKET_URL="$PROD_API_URL" \
  VITE_SENTRY_DSN="$(grep -E '^SENTRY_DSN=' "$PROD_ENV_FILE" | cut -d= -f2- | tr -d '\n\r ')" \
  npm run build:web:prod

# ── 9. Run migrations against production database ────────────────────────────
log "Running database migrations (prod)"
cd apps/api
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROD_ENV_FILE" | cut -d= -f2-)" \
  npx prisma migrate deploy
cd ../..

# ── 10. Copy Prisma generated client ─────────────────────────────────────────
log "Copying Prisma client"
mkdir -p apps/api/dist/generated
cp -r apps/api/src/generated/prisma apps/api/dist/generated/

# ── 11. Restart prod services ─────────────────────────────────────────────────
log "Restarting prod services"
sudo systemctl restart gem-api gem-web

# ── 12. Confirm services are up ───────────────────────────────────────────────
log "Service status"
sleep 2
{ set +x; } 2>/dev/null
systemctl is-active --quiet gem-api && echo "  gem-api  : active" || echo "  gem-api  : INACTIVE"
systemctl is-active --quiet gem-web && echo "  gem-web  : active" || echo "  gem-web  : INACTIVE"
set -x
journalctl -u gem-api --since "10 seconds ago" --no-pager || true

log "Done — production live at https://gem.aidanlenahan.com"
