#!/usr/bin/env bash
# scripts/notify.sh
# Shared deploy notification helper.
#
# Usage in a deploy script:
#   source "$(dirname "$0")/notify.sh"
#   setup_notifications "/etc/gem/gem-api.env" "production"
#   set -x   # optional — enables full command tracing in the email log
#   # ... all deploy work ...
#   # On EXIT (success or failure) a single email is sent to all NOTIFY_RECIPIENTS
#   # with full verbose log attached.
#
# SMTP credentials are loaded from the env file passed to setup_notifications.
# Falls back through /etc/gem/gem-api.env → /etc/gem/gem-api-dev.env → apps/api/.env.
#
# Set NOTIFY_SEND=0 before exiting to suppress the email (e.g. user aborted).

NOTIFY_RECIPIENTS=("awood4555@gmail.com" "aidanlenahan@gmail.com")
NOTIFY_SEND=1
NOTIFY_LABEL="unknown"
NOTIFY_FROM_ADDR=""   # override display From: address (envelope sender stays as SMTP user)
NOTIFY_FROM_NAME="GEM Deploy"  # display name in From: header

_GEM_NOTIFY_LOG=""
_GEM_NOTIFY_ENV=""
_GEM_NOTIFY_T0=0
_GEM_NOTIFY_ORIG_FD=-1

# ── SMTP config ───────────────────────────────────────────────────────────────
# Loads SMTP_HOST/PORT/USER/PASS from the first env file that has them.
_notify_load_smtp() {
  local ef
  local candidates=(
    "$_GEM_NOTIFY_ENV"
    "/etc/gem/gem-api.env"
    "/etc/gem/gem-api-dev.env"
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/../apps/api/.env"
    "/var/www/gem/apps/api/.env"
  )
  for ef in "${candidates[@]}"; do
    [[ -n "$ef" && -f "$ef" ]] || continue
    _N_HOST="$(grep -E '^SMTP_HOST='  "$ef" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
    _N_PORT="$(grep -E '^SMTP_PORT='  "$ef" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
    _N_USER="$(grep -E '^SMTP_USER='  "$ef" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
    _N_PASS="$(grep -E '^SMTP_PASS='  "$ef" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
    if [[ -n "$_N_HOST" && -n "$_N_USER" && -n "$_N_PASS" ]]; then
      _N_CONF="$ef"
      _N_PORT="${_N_PORT:-465}"
      return 0
    fi
  done
  _N_HOST=""; _N_USER=""; _N_PASS=""; _N_CONF="(not found)"
  return 1
}

# ── Exit handler ──────────────────────────────────────────────────────────────
_gem_notify_send() {
  local exit_code="${1:-0}"

  # Disable set -x so cleanup output doesn't pollute terminal
  { set +x; } 2>/dev/null

  # Restore real stdout/stderr — this closes the write end of the tee pipe so
  # tee can see EOF, flush its buffer, and exit before we read the log file.
  if [[ "$_GEM_NOTIFY_ORIG_FD" -ge 0 ]]; then
    exec 1>&"$_GEM_NOTIFY_ORIG_FD" 2>&1
    exec {_GEM_NOTIFY_ORIG_FD}>&-
    _GEM_NOTIFY_ORIG_FD=-1
    sleep 0.5  # allow tee subprocess to finish writing
  fi

  [[ "${NOTIFY_SEND:-1}" == "1" ]] || { rm -f "$_GEM_NOTIFY_LOG"; return 0; }
  [[ -z "$_GEM_NOTIFY_LOG" ]]      && return 0

  # ── Metadata ──
  local elapsed=$(( $(date +%s) - _GEM_NOTIFY_T0 ))
  local dur
  if (( elapsed >= 60 )); then
    dur="$(( elapsed / 60 ))m $(( elapsed % 60 ))s"
  else
    dur="${elapsed}s"
  fi

  local status_line status_tag
  if [[ "$exit_code" -eq 0 ]]; then
    status_line="SUCCESS — completed without errors"
    status_tag="[OK]"
  else
    status_line="FAILED — exited with code ${exit_code}"
    status_tag="[FAIL]"
  fi

  local branch commit sha commit_msg commit_author commit_date
  branch="$(git       -C /var/www/gem rev-parse --abbrev-ref HEAD          2>/dev/null || echo 'unknown')"
  commit="$(git       -C /var/www/gem rev-parse HEAD                        2>/dev/null || echo 'unknown')"
  sha="$(git          -C /var/www/gem rev-parse --short HEAD                2>/dev/null || echo 'unknown')"
  commit_msg="$(git   -C /var/www/gem log -1 --pretty='%s'                 2>/dev/null || echo 'unknown')"
  commit_author="$(git -C /var/www/gem log -1 --pretty='%an <%ae>'         2>/dev/null || echo 'unknown')"
  commit_date="$(git  -C /var/www/gem log -1 --pretty='%cd' \
                      --date=format:'%Y-%m-%d %H:%M:%S'                    2>/dev/null || echo 'unknown')"

  local host triggered_by
  host="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo 'unknown')"
  triggered_by="$(logname 2>/dev/null || whoami 2>/dev/null || echo 'unknown')"
  local started_at; started_at="$(date -d "@${_GEM_NOTIFY_T0}" '+%Y-%m-%d %H:%M:%S %Z' \
                                   2>/dev/null || echo 'unknown')"
  local finished_at; finished_at="$(date '+%Y-%m-%d %H:%M:%S %Z')"

  # ── Log body — strip ANSI/VT escape codes and bare CRs ──
  local log_body=""
  if [[ -f "$_GEM_NOTIFY_LOG" ]]; then
    log_body="$(sed \
      -e 's/\x1b\[[0-9;:]*[mGKHFJABCDsufhilnpq]//g' \
      -e 's/\x1b[()][AB012]//g' \
      -e 's/\x1b[<=>]//g' \
      -e 's/\x1b[NOPQRSTUVWXYZ\\^_]//g' \
      -e 's/\r//g' \
      -e '/^$/N;/^\n$/d' \
      "$_GEM_NOTIFY_LOG" 2>/dev/null || echo '(log file unavailable)')"
  fi
  local log_lines; log_lines="$(wc -l < "$_GEM_NOTIFY_LOG" 2>/dev/null || echo '?')"
  local log_bytes; log_bytes="$(wc -c < "$_GEM_NOTIFY_LOG" 2>/dev/null || echo '?')"

  # ── Load SMTP ──
  if ! _notify_load_smtp; then
    printf "\n[notify] WARNING: No SMTP config found — email not sent.\n"
    rm -f "$_GEM_NOTIFY_LOG"
    return 0
  fi

  # ── Subject ──
  local subject="${status_tag} [GEM] ${NOTIFY_LABEL^^} — ${status_line} — $(date '+%Y-%m-%d %H:%M')"
  local to_hdr; to_hdr="$(IFS=', '; echo "${NOTIFY_RECIPIENTS[*]}")"

  # ── Build RFC 2822 message ──
  local msg_file; msg_file="$(mktemp /tmp/gem-email-XXXXXX.eml)"
  {
    printf "Date: %s\r\n"              "$(date -R)"
    local _from_addr="${NOTIFY_FROM_ADDR:-$_N_USER}"
    local _from_name="${NOTIFY_FROM_NAME:-GEM Deploy}"
    printf "From: %s <%s>\r\n" "$_from_name" "$_from_addr"
    printf "To: %s\r\n"               "$to_hdr"
    printf "Subject: %s\r\n"          "$subject"
    printf "MIME-Version: 1.0\r\n"
    printf "Content-Type: text/plain; charset=UTF-8\r\n"
    printf "\r\n"
    # ── Header block ──────────────────────────────────────────
    printf "================================================================\r\n"
    printf "  GEM DEPLOY NOTIFICATION\r\n"
    printf "================================================================\r\n"
    printf "\r\n"
    printf "  Label          : %s\r\n"  "$NOTIFY_LABEL"
    printf "  Status         : %s\r\n"  "$status_line"
    printf "  Exit code      : %s\r\n"  "$exit_code"
    printf "  Duration       : %s\r\n"  "$dur"
    printf "  Started at     : %s\r\n"  "$started_at"
    printf "  Finished at    : %s\r\n"  "$finished_at"
    printf "\r\n"
    printf "  Branch         : %s\r\n"  "$branch"
    printf "  Commit (full)  : %s\r\n"  "$commit"
    printf "  Short SHA      : %s\r\n"  "$sha"
    printf "  Commit message : %s\r\n"  "$commit_msg"
    printf "  Commit author  : %s\r\n"  "$commit_author"
    printf "  Commit date    : %s\r\n"  "$commit_date"
    printf "\r\n"
    printf "  Host           : %s\r\n"  "$host"
    printf "  Triggered by   : %s\r\n"  "$triggered_by"
    printf "  Working dir    : /var/www/gem\r\n"
    printf "  Script         : %s\r\n"  "${BASH_SOURCE[-1]:-unknown}"
    printf "  Shell PID      : %d\r\n"  "$$"
    printf "\r\n"
    printf "  SMTP host      : smtps://%s:%s\r\n"  "$_N_HOST" "$_N_PORT"
    printf "  SMTP user      : %s\r\n"  "$_N_USER"
    printf "  SMTP config    : %s\r\n"  "$_N_CONF"
    printf "  Email sent to  : %s\r\n"  "$to_hdr"
    printf "\r\n"
    printf "  Log size       : %s bytes (%s lines)\r\n"  "$log_bytes" "$log_lines"
    printf "\r\n"
    # ── Log body ──────────────────────────────────────────────
    printf "================================================================\r\n"
    printf "  FULL LOG  (stdout + stderr + set -x command traces)\r\n"
    printf "================================================================\r\n"
    printf "\r\n"
    while IFS= read -r _line || [[ -n "$_line" ]]; do
      printf "%s\r\n" "$_line"
    done <<< "$log_body"
    printf "\r\n"
    printf "================================================================\r\n"
    printf "  END OF LOG\r\n"
    printf "================================================================\r\n"
  } > "$msg_file"

  # ── Build --mail-rcpt args (one per recipient, single email) ──
  local rcpt_args=()
  for r in "${NOTIFY_RECIPIENTS[@]}"; do rcpt_args+=(--mail-rcpt "$r"); done

  printf "\n[notify] Sending deploy notification...\n"
  printf "[notify]   SMTP      : smtps://%s:%s\n"  "$_N_HOST" "$_N_PORT"
  printf "[notify]   From      : %s\n"              "$_N_USER"
  printf "[notify]   To        : %s\n"              "$to_hdr"
  printf "[notify]   Subject   : %s\n"              "$subject"
  printf "[notify]   Log size  : %s bytes\n"        "$log_bytes"

  if curl \
      --silent --show-error \
      --url     "smtps://${_N_HOST}:${_N_PORT}" \
      --user    "${_N_USER}:${_N_PASS}" \
      --mail-from "$_N_USER" \
      "${rcpt_args[@]}" \
      --upload-file "$msg_file" 2>&1; then
    printf "[notify]   Result    : sent successfully\n"
  else
    printf "[notify]   Result    : SEND FAILED (check SMTP credentials — non-fatal)\n" >&2
  fi

  rm -f "$msg_file"
  rm -f "$_GEM_NOTIFY_LOG"
}

# ── Public API ────────────────────────────────────────────────────────────────
# setup_notifications ENV_FILE LABEL
#
# Call once before the first deploy step.  After this, all stdout+stderr is
# captured in a temp log.  On EXIT (any cause), the log is emailed.
#
# ENV_FILE : path to the app env file to read SMTP config from.
#            Pass "" or a non-existent path to use the fallback chain.
# LABEL    : human label for subject line (e.g. "production", "dev")
setup_notifications() {
  local env_file="${1:-}"
  local label="${2:-Script}"

  _GEM_NOTIFY_ENV="$env_file"
  NOTIFY_LABEL="$label"
  _GEM_NOTIFY_T0=$(date +%s)
  _GEM_NOTIFY_LOG=$(mktemp /tmp/gem-deploy-XXXXXX.log)
  NOTIFY_SEND=1

  # Save real stdout to a dynamic spare fd, then tee everything into the log.
  exec {_GEM_NOTIFY_ORIG_FD}>&1
  exec > >(tee -a "$_GEM_NOTIFY_LOG") 2>&1

  trap '_gem_notify_send "$?"' EXIT

  printf "[notify] ─────────────────────────────────────────────────────────\n"
  printf "[notify]   GEM Deploy  : %s\n"   "$NOTIFY_LABEL"
  printf "[notify]   Started at  : %s\n"   "$(date '+%Y-%m-%d %H:%M:%S %Z')"
  printf "[notify]   Log file    : %s\n"   "$_GEM_NOTIFY_LOG"
  printf "[notify]   Email to    : %s\n"   "${NOTIFY_RECIPIENTS[*]}"
  printf "[notify]   Branch      : %s\n"   "$(git -C /var/www/gem rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  printf "[notify]   Commit      : %s  %s\n" \
    "$(git -C /var/www/gem rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    "$(git -C /var/www/gem log -1 --pretty='%s' 2>/dev/null || echo '')"
  printf "[notify] ─────────────────────────────────────────────────────────\n"
  printf "\n"
}
