#!/usr/bin/env bash
set -euo pipefail

KEY_DIR="${HUMITE_KEY_STORAGE_PATH:-/var/lib/humite/keys}"
mkdir -p /tmp/humite \
  "${HUMITE_FONT_STORAGE_PATH:-/var/lib/humite/fonts}" \
  "${HUMITE_CONTENT_STORAGE_PATH:-/var/lib/humite/content}/articles" \
  "${HUMITE_CONTENT_STORAGE_PATH:-/var/lib/humite/content}/vault" \
  "$KEY_DIR" 2>/dev/null || true

ensure_key_file() {
  local key_file="$1"
  local has_lock="${2:-0}"
  if [[ -s "$key_file" ]]; then
    return 0
  fi
  local tmp_file="${key_file}.tmp.$$"
  rm -f "$tmp_file"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 > "$tmp_file" 2>/dev/null || true
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$tmp_file" 2>/dev/null || true
  fi
  if [[ -s "$tmp_file" ]]; then
    chmod 600 "$tmp_file" 2>/dev/null || true
    if [[ "$has_lock" -eq 1 && -e "$key_file" && ! -s "$key_file" ]]; then
      rm -f "$key_file" 2>/dev/null || true
    fi
    if [[ ! -s "$key_file" ]]; then
      mv -n "$tmp_file" "$key_file" 2>/dev/null || true
    fi
  fi
  rm -f "$tmp_file"
}

generate_or_load_key() {
  local var_name="$1"
  local key_file="$2"
  local current_val="${!var_name:-}"
  if [[ -n "$current_val" ]]; then
    return 0
  fi
  umask 077
  if command -v flock >/dev/null 2>&1; then
    if exec 9>>"$KEY_DIR/.keys.lock" 2>/dev/null; then
      flock -x 9
      ensure_key_file "$key_file" 1
      flock -u 9 2>/dev/null || true
      exec 9>&-
    else
      ensure_key_file "$key_file" 0
    fi
  else
    ensure_key_file "$key_file" 0
  fi
  if [[ -s "$key_file" ]]; then
    chmod 600 "$key_file" 2>/dev/null || true
    export "$var_name=$(tr -d '\r\n' < "$key_file")"
  fi
}

generate_or_load_key "HUMITE_AI_SETTINGS_ENCRYPTION_KEY" "$KEY_DIR/ai-settings-encryption-key"
generate_or_load_key "HUMITE_TWO_FACTOR_ENCRYPTION_KEY" "$KEY_DIR/two-factor-encryption-key"

exec java -jar /app/humite.jar "$@"
