#!/usr/bin/env bash
set -euo pipefail

KEY_DIR="${HUMITE_KEY_STORAGE_PATH:-/var/lib/humite/keys}"
mkdir -p /tmp/humite \
  "${HUMITE_FONT_STORAGE_PATH:-/var/lib/humite/fonts}" \
  "${HUMITE_CONTENT_STORAGE_PATH:-/var/lib/humite/content}/articles" \
  "${HUMITE_CONTENT_STORAGE_PATH:-/var/lib/humite/content}/vault" \
  "$KEY_DIR" 2>/dev/null || true

generate_or_load_key() {
  local var_name="$1"
  local key_file="$2"
  local current_val="${!var_name:-}"
  if [[ -n "$current_val" ]]; then
    return 0
  fi
  umask 077
  if [[ ! -s "$key_file" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32 > "$key_file" 2>/dev/null || true
    else
      head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$key_file" 2>/dev/null || true
    fi
  fi
  if [[ -s "$key_file" ]]; then
    export "$var_name=$(tr -d '\r\n' < "$key_file")"
  fi
}

generate_or_load_key "HUMITE_AI_SETTINGS_ENCRYPTION_KEY" "$KEY_DIR/ai-settings-encryption-key"
generate_or_load_key "HUMITE_TWO_FACTOR_ENCRYPTION_KEY" "$KEY_DIR/two-factor-encryption-key"

exec java -jar /app/humite.jar "$@"
