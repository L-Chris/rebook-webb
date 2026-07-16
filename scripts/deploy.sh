#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLISH_DIR="${PUBLISH_DIR:-/home/data/www/read.rethinkos.com}"
NPM_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
export VITE_REBOOK_SERVICE_URL="${VITE_REBOOK_SERVICE_URL:-https://read.rethinkos.com/api}"

TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_GROUP="$(id -gn "$TARGET_USER" 2>/dev/null || id -gn)"

fix_owner() {
  local path="$1"
  [ -e "$path" ] || return 0

  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$TARGET_USER:$TARGET_GROUP" "$path"
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$TARGET_USER:$TARGET_GROUP" "$path"
  else
    echo "warning: sudo not found, skip chown for $path" >&2
  fi
}

fix_web_permissions() {
  local path="$1"
  [ -e "$path" ] || return 0

  find "$path" -type d -exec chmod 755 {} +
  find "$path" -type f -exec chmod 644 {} +
}

mkdir -p "$PUBLISH_DIR"
fix_owner "$APP_DIR/dist"
fix_owner "$PUBLISH_DIR"

cd "$APP_DIR"
npm_config_registry="$NPM_REGISTRY" npm install
npm run build

rsync -a --delete --exclude '*.map' "$APP_DIR/dist/" "$PUBLISH_DIR/"
find "$PUBLISH_DIR/assets" -name '*.map' -delete 2>/dev/null || true
fix_owner "$APP_DIR/dist"
fix_owner "$PUBLISH_DIR"
fix_web_permissions "$APP_DIR/dist"
fix_web_permissions "$PUBLISH_DIR"

echo "Published rebook-web to $PUBLISH_DIR"
echo "rebook-service API: $VITE_REBOOK_SERVICE_URL"
