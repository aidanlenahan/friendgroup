#!/bin/bash
set -euo pipefail
cd /var/www/gem

echo "Building..."
npm --workspace apps/web run build:fast

echo "Restarting gem-web..."
sudo systemctl restart gem-web

echo "Done."
