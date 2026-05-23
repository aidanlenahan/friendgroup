#!/usr/bin/env bash
# One-time setup for the dev environment. Run this once as a user with sudo.
# After this, deploy-dev.sh handles all future deploys.
set -euo pipefail

log() { echo "==> $*"; }

# ── 1. Install systemd services ──────────────────────────────────────────────
log "Installing dev systemd services..."
sudo cp /var/www/gem/infra/systemd/gem-api.dev.service /etc/systemd/system/gem-api-dev.service
sudo cp /var/www/gem/infra/systemd/gem-web.dev.service /etc/systemd/system/gem-web-dev.service
sudo systemctl daemon-reload
log "Services registered: gem-api-dev, gem-web-dev"

# ── 2. Create MinIO bucket for dev media ────────────────────────────────────
log "Creating MinIO bucket gem-media-dev..."
# Uses the mc (MinIO client) alias 'local' — configure it first if needed:
#   mc alias set local http://127.0.0.1:9000 <access-key> <secret-key>
if command -v mc &>/dev/null; then
  mc mb --ignore-existing local/gem-media-dev
  log "Bucket created."
else
  log "mc not found — create the bucket manually in the MinIO console (http://127.0.0.1:9001)"
  log "Bucket name: gem-media-dev"
fi

# ── 3. Run initial migrations on gem_staging ─────────────────────────────────
log "Running initial migrations on gem_staging..."
cd /var/www/gem/apps/api
DATABASE_URL="$(grep -E '^DATABASE_URL=' /etc/gem/gem-api-dev.env | cut -d= -f2-)" \
  npx prisma migrate deploy
cd /var/www/gem

log ""
log "Setup complete! Next steps:"
log "  1. Add gem-dev.aidanlenahan.com and api-gem-dev.aidanlenahan.com to your"
log "     Cloudflare tunnel config (see infra/cloudflared/gem-dev.config.example.yml)"
log "  2. Run: ./scripts/deploy-dev.sh"
log "  3. To stop dev when done: sudo systemctl stop gem-api-dev gem-web-dev"
