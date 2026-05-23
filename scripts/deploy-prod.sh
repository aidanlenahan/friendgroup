#!/usr/bin/env bash
# Deploy current branch to production.
# Prod runs at gem.aidanlenahan.com / api-gem.aidanlenahan.com
# Reads config from /etc/gem/gem-api.env
set -euo pipefail

PROD_ENV_FILE="/etc/gem/gem-api.env"
PROD_API_URL="https://api-gem.aidanlenahan.com"

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

# ── 3. Install dependencies ──────────────────────────────────────────────────
log "Installing dependencies..."
npm install --silent

# ── 4. Build API ─────────────────────────────────────────────────────────────
log "Building API..."
npm run build:api

# ── 5. Build web with prod API URL ──────────────────────────────────────────
log "Building web (targeting $PROD_API_URL)..."
VITE_API_BASE_URL="$PROD_API_URL" npm run build:web

# ── 6. Run migrations against production database ────────────────────────────
log "Running database migrations (prod)..."
cd apps/api
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$PROD_ENV_FILE" | cut -d= -f2-)" \
  npx prisma migrate deploy
cd ../..

# ── 7. Copy Prisma generated client ──────────────────────────────────────────
log "Copying Prisma client..."
mkdir -p apps/api/dist/generated
cp -r apps/api/src/generated/prisma apps/api/dist/generated/

# ── 8. Restart prod services ──────────────────────────────────────────────────
log "Restarting prod services..."
sudo systemctl restart gem-api gem-web

log "Done. Production is live at https://gem.aidanlenahan.com"
