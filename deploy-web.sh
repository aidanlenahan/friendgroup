#!/bin/bash
set -euo pipefail
cd /var/www/gem

echo "==> Building API..."
npm --workspace apps/api run build

echo "==> Restarting gem-api..."
sudo systemctl restart gem-api

echo "==> Building web..."
npm --workspace apps/web run build:fast

echo "==> Restarting gem-web..."
sudo systemctl restart gem-web

echo "==> Done. Waiting for API to be ready..."
sleep 2
journalctl -u gem-api --since "5 seconds ago" --no-pager | grep -E "mailer|Listening|listening|started|error" || true

echo ""
echo "Live logs: journalctl -u gem-api -f"
