#!/usr/bin/env bash
set -euo pipefail

PROD_ENV="/etc/gem/gem-api.env"
DEV_ENV="/etc/gem/gem-api-dev.env"
PROD_API_URL="https://api-gem.aidanlenahan.com"
DEV_API_URL="https://api-gem-dev.aidanlenahan.com"

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
  npm install --silent
  ok "Dependencies ready"
}

build_api() {
  step "Building API"
  npm run build:api --silent
  mkdir -p apps/api/dist/generated
  cp -r apps/api/src/generated/prisma apps/api/dist/generated/
  ok "API built"
}

build_web() {
  step "Building web  →  $1"
  VITE_API_BASE_URL="$1" npm run build:web --silent
  ok "Web built"
}

migrate() {
  step "Migrating $2 database"
  local url; url="$(db_url "$1")"
  (cd apps/api && DATABASE_URL="$url" npx prisma migrate deploy 2>&1 \
    | grep -E '(migration|Applying|applied|up to date)' || true)
  ok "Migrations applied"
}

restart_prod() {
  step "Restarting production"
  sudo systemctl restart gem-api gem-web
  ok "gem.aidanlenahan.com  is live"
}

restart_dev() {
  step "Restarting dev"
  sudo systemctl restart gem-api-dev gem-web-dev
  ok "gem-dev.aidanlenahan.com  is live"
}

stop_dev() {
  step "Stopping dev"
  sudo systemctl stop gem-api-dev gem-web-dev 2>/dev/null || true
  ok "Dev stopped"
}

deploy_prod() {
  [[ -f "$PROD_ENV" ]] || die "Missing $PROD_ENV"
  deps; build_api; build_web "$PROD_API_URL"; migrate "$PROD_ENV" "production"; restart_prod
}

deploy_dev() {
  [[ -f "$DEV_ENV" ]] || die "Missing $DEV_ENV — run scripts/setup-dev-env.sh first"
  deps; build_api; build_web "$DEV_API_URL"; migrate "$DEV_ENV" "dev"; restart_dev
}

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
    deploy_prod
    ;;
  2)
    deploy_prod
    stop_dev
    ;;
  3)
    deploy_dev
    ;;
  4)
    stop_dev
    ;;
  5)
    [[ -f "$PROD_ENV" ]] || die "Missing $PROD_ENV"
    restart_prod
    ;;
  6)
    [[ -f "$DEV_ENV" ]] || die "Missing $DEV_ENV"
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
