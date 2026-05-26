#!/usr/bin/env bash
set -euo pipefail

PROD_ENV="/etc/gem/gem-api.env"
DEV_ENV="/etc/gem/gem-api-dev.env"
PROD_API_URL="https://api-gem.aidanlenahan.com"
DEV_API_URL="https://api-gem-dev.aidanlenahan.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=notify.sh
source "$SCRIPT_DIR/notify.sh"

# Pick the best available env file that has SMTP credentials.
_gem_smtp_env() {
  for _f in "$PROD_ENV" "$DEV_ENV" "/var/www/gem/apps/api/.env"; do
    if [[ -f "$_f" ]] && grep -q "^SMTP_HOST=" "$_f" 2>/dev/null; then
      echo "$_f"; return
    fi
  done
  echo ""
}

# ── Colors ────────────────────────────────────────────────────────────────────
B='\033[1m'         # bold
D='\033[2m'         # dim
R='\033[0m'         # reset
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
CYN='\033[0;36m'

# ── Helpers ───────────────────────────────────────────────────────────────────
step() { echo -e "\n${CYN}▸${R} ${B}$*${R}"; }
ok()   { echo -e "${GRN}  ✓${R}  $*"; }
die()  { echo -e "\n${RED}  ✗  $*${R}\n" >&2; exit 1; }

db_url() { grep -E '^DATABASE_URL=' "$1" | cut -d= -f2-; }

svc_status() {
  systemctl is-active --quiet "$1" 2>/dev/null && echo -e "${GRN}●${R} running" || echo -e "${D}○ stopped${R}"
}

# ── Build & deploy primitives ─────────────────────────────────────────────────
deps() {
  step "Installing dependencies"
  npm install
  ok "Dependencies ready"
}

build_api() {
  step "Building API"
  npm run build:api
  mkdir -p apps/api/dist/generated
  cp -r apps/api/src/generated/prisma apps/api/dist/generated/
  ok "API built"
}

build_web() {
  step "Building web  →  $1"
  local _dsn; _dsn="$(grep -E '^SENTRY_DSN=' "${2:-/dev/null}" 2>/dev/null | cut -d= -f2- || true)"
  VITE_API_BASE_URL="$1" VITE_SENTRY_DSN="$_dsn" npm run build:web
  ok "Web built"
}

migrate() {
  step "Migrating $2 database"
  local url; url="$(db_url "$1")"
  (cd apps/api && DATABASE_URL="$url" npx prisma migrate deploy 2>&1) || true
  ok "Migrations applied"
}

restart_prod() {
  step "Restarting production"
  sudo systemctl restart gem-api gem-web
  sleep 2
  systemctl is-active --quiet gem-api && ok "gem-api : active" || echo "  gem-api : INACTIVE"
  systemctl is-active --quiet gem-web && ok "gem-web : active" || echo "  gem-web : INACTIVE"
  journalctl -u gem-api --since "10 seconds ago" --no-pager 2>/dev/null || true
  ok "gem.aidanlenahan.com  is live"
}

restart_dev() {
  step "Restarting dev"
  sudo systemctl restart gem-api-dev gem-web-dev
  sleep 2
  systemctl is-active --quiet gem-api-dev && ok "gem-api-dev : active" || echo "  gem-api-dev : INACTIVE"
  systemctl is-active --quiet gem-web-dev && ok "gem-web-dev : active" || echo "  gem-web-dev : INACTIVE"
  journalctl -u gem-api-dev --since "10 seconds ago" --no-pager 2>/dev/null || true
  ok "gem-dev.aidanlenahan.com  is live"
}

stop_dev() {
  step "Stopping dev"
  sudo systemctl stop gem-api-dev gem-web-dev 2>/dev/null || true
  ok "Dev stopped"
}

deploy_prod() {
  [[ -f "$PROD_ENV" ]] || die "Missing $PROD_ENV"
  deps; build_api; build_web "$PROD_API_URL" "$PROD_ENV"; migrate "$PROD_ENV" "production"; restart_prod
}

deploy_dev() {
  [[ -f "$DEV_ENV" ]] || die "Missing $DEV_ENV — run scripts/setup-dev-env.sh first"
  deps; build_api; build_web "$DEV_API_URL" "$DEV_ENV"; migrate "$DEV_ENV" "dev"; restart_dev
}

# ── Sudo pre-auth ─────────────────────────────────────────────────────────────
sudo -v || die "sudo authentication failed"

# ── Menu ──────────────────────────────────────────────────────────────────────
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
PROD_ST=$(svc_status gem-api)
DEV_ST=$(svc_status gem-api-dev)

clear
echo
echo -e "  ${B}GEM${R}  ${D}·  branch: ${BRANCH}${R}"
echo
echo -e "  ${D}prod  ${R}${PROD_ST}      ${D}dev  ${R}${DEV_ST}"
echo
echo -e "  ───────────────────────────────────"
echo -e "  ${B}1${R}  Deploy → production"
echo -e "  ${B}2${R}  Deploy → production  +  stop dev"
echo -e "  ${B}3${R}  Deploy → dev"
echo -e "  ${B}4${R}  Stop dev"
echo -e "  ${B}5${R}  Restart production  ${D}(no build)${R}"
echo -e "  ${B}6${R}  Restart dev  ${D}(no build)${R}"
echo -e "  ───────────────────────────────────"
echo -e "  ${D}q  quit${R}"
echo
read -rp "  → " choice
echo

case "$choice" in
  1)
    setup_notifications "$(_gem_smtp_env)" "Deploy -> Production"
    set -x
    deploy_prod
    ;;
  2)
    setup_notifications "$(_gem_smtp_env)" "Deploy -> Production + Stop Dev"
    set -x
    deploy_prod
    stop_dev
    ;;
  3)
    setup_notifications "$(_gem_smtp_env)" "Deploy -> Dev"
    set -x
    deploy_dev
    ;;
  4)
    setup_notifications "$(_gem_smtp_env)" "Stop Dev"
    set -x
    stop_dev
    ;;
  5)
    [[ -f "$PROD_ENV" ]] || die "Missing $PROD_ENV"
    setup_notifications "$(_gem_smtp_env)" "Restart Production (no build)"
    set -x
    restart_prod
    ;;
  6)
    [[ -f "$DEV_ENV" ]] || die "Missing $DEV_ENV"
    setup_notifications "$(_gem_smtp_env)" "Restart Dev (no build)"
    set -x
    restart_dev
    ;;
  q|Q|"")
    echo -e "  ${D}bye${R}\n"
    exit 0
    ;;
  *)
    echo -e "  ${RED}Invalid choice${R}\n"
    exit 1
    ;;
esac

echo
