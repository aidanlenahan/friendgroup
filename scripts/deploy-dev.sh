#!/usr/bin/env bash
# Deploy current branch to the dev environment.
# Dev runs at gem-dev.aidanlenahan.com / api-gem-dev.aidanlenahan.com
# Reads config from /etc/gem/gem-api-dev.env
set -euo pipefail

DEV_ENV_FILE="/etc/gem/gem-api-dev.env"
DEV_API_URL="https://api-gem-dev.aidanlenahan.com"

log() { echo "==> $*"; }

# ── 1. Verify env file exists ────────────────────────────────────────────────
if [[ ! -f "$DEV_ENV_FILE" ]]; then
  echo "ERROR: $DEV_ENV_FILE not found."
  echo "Copy infra/gem-api-dev.env.example to $DEV_ENV_FILE and fill in the values."
  exit 1
fi

# ── 2. Install dependencies ──────────────────────────────────────────────────
log "Installing dependencies..."
npm install --silent

# ── 3. Build API ─────────────────────────────────────────────────────────────
log "Building API..."
npm run build:api

# ── 4. Build web with dev API URL ───────────────────────────────────────────
log "Building web (targeting $DEV_API_URL)..."
VITE_API_BASE_URL="$DEV_API_URL" npm run build:web

# ── 5. Run migrations against dev database ───────────────────────────────────
log "Running database migrations (dev)..."
# Prisma 7 reads DATABASE_URL via prisma.config.ts; env var overrides dotenv.
cd apps/api
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$DEV_ENV_FILE" | cut -d= -f2-)" \
  npx prisma migrate deploy
cd ../..

# ── 6. Copy Prisma generated client ──────────────────────────────────────────
log "Copying Prisma client..."
mkdir -p apps/api/dist/generated
cp -r apps/api/src/generated/prisma apps/api/dist/generated/

# ── 7. Restart dev services ───────────────────────────────────────────────────
log "Restarting dev services..."
sudo systemctl restart gem-api-dev gem-web-dev

log "Done. Dev environment is live at https://gem-dev.aidanlenahan.com"
log "To stop dev: sudo systemctl stop gem-api-dev gem-web-dev"
