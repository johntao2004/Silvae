#!/usr/bin/env bash
# Humite 一键 Docker 部署脚本
# 自动初始化 .env 随机密钥、创建宿主机书库挂载目录并启动全栈容器
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未检测到 docker，请先安装 Docker Desktop 或 Docker Engine。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：未检测到 docker compose 插件，请升级 Docker 或安装 Compose v2。" >&2
  exit 1
fi

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

read_env_val() {
  local key="$1"
  awk -F= -v k="$key" '$1 == k { val = substr($0, index($0, "=") + 1) } END { print val }' .env 2>/dev/null \
    | tr -d '\r' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

if [[ ! -f .env ]]; then
  umask 077
  DB_PASS="$(rand_hex 16)"
  AI_KEY="$(rand_hex 32)"
  TFA_KEY="$(rand_hex 32)"
  TMP_ENV=".env.tmp.$$"
  awk -v db="$DB_PASS" -v ai="$AI_KEY" -v tfa="$TFA_KEY" '
    /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" db; next }
    /^HUMITE_AI_SETTINGS_ENCRYPTION_KEY=/ { print "HUMITE_AI_SETTINGS_ENCRYPTION_KEY=" ai; next }
    /^HUMITE_TWO_FACTOR_ENCRYPTION_KEY=/ { print "HUMITE_TWO_FACTOR_ENCRYPTION_KEY=" tfa; next }
    { print }
  ' .env.example > "$TMP_ENV"
  chmod 600 "$TMP_ENV"
  mv "$TMP_ENV" .env
  echo "已生成 .env 配置文件并自动初始化随机数据库密码与加密密钥。"
fi

DB_PASS_CURRENT="$(read_env_val "POSTGRES_PASSWORD")"
if [[ -z "$DB_PASS_CURRENT" || "$DB_PASS_CURRENT" == "change-me-before-production" ]]; then
  echo "错误：.env 中的 POSTGRES_PASSWORD 尚未设置强密码，请编辑 .env 后重试（或删除 .env 由脚本重新生成）。" >&2
  exit 1
fi

LIB_DIR="$(read_env_val "HUMITE_LIBRARY_MAIN")"
LIB_DIR="${LIB_DIR:-./data/library}"
mkdir -p "$LIB_DIR"

HTTP_PORT="$(read_env_val "HUMITE_HTTP_PORT")"
HTTP_PORT="${HTTP_PORT:-8080}"

if [[ "${1:-}" == "--build" ]]; then
  echo "正在从本地构建全栈镜像并启动 Humite 容器栈..."
  docker compose up -d --build
else
  echo "正在启动 Humite 容器栈（如本地无预构建镜像将自动构建）..."
  if ! docker compose pull app 2>/dev/null; then
    echo "远程镜像尚未拉取，正在自动切换为本地多阶段构建..."
    docker compose up -d --build
  else
    docker compose up -d
  fi
fi

if command -v curl >/dev/null 2>&1; then
  echo "正在等待 Humite 服务就绪 (http://localhost:${HTTP_PORT})..."
  for ((i=0; i<60; i++)); do
    if curl -fsS "http://127.0.0.1:${HTTP_PORT}/actuator/health/readiness" 2>/dev/null | grep -q '"UP"'; then
      echo "Humite 已就绪！请访问：http://localhost:${HTTP_PORT}（首次启动请访问 http://localhost:${HTTP_PORT}/setup 创建 Owner 账号）"
      exit 0
    fi
    sleep 2
  done
fi

echo "容器已启动，请通过 'docker compose logs -f app' 查看启动进度。"
