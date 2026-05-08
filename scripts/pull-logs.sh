#!/usr/bin/env bash
# Pull production logs from server to local logs/prod/ directory.
# Usage: scripts/pull-logs.sh [--tail N]
# Examples:
#   scripts/pull-logs.sh           # full sync
#   scripts/pull-logs.sh --tail 500  # only print last 500 lines per log after sync
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/Documents/AI-APP/task-manger/Harvey.pem}"
HOST="${LEADER_SYNC_HOST:-root@47.84.35.154}"
REMOTE_LOGS=(
  "/var/log/leader-api.log"
  "/var/log/leader-web.log"
  "/var/log/leader-worker.log"
)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DIR="$REPO_ROOT/logs/prod"
mkdir -p "$LOCAL_DIR"

TAIL_N=""
if [[ "${1:-}" == "--tail" && -n "${2:-}" ]]; then
  TAIL_N="$2"
fi

echo "→ Syncing production logs to $LOCAL_DIR"
for path in "${REMOTE_LOGS[@]}"; do
  name="$(basename "$path")"
  rsync -az -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
    "${HOST}:${path}" "$LOCAL_DIR/$name" 2>/dev/null || {
      echo "  ⚠ failed to sync $path"
      continue
    }
  size=$(wc -l < "$LOCAL_DIR/$name" 2>/dev/null || echo 0)
  echo "  ✓ $name ($size lines)"
done

if [[ -n "$TAIL_N" ]]; then
  echo ""
  for path in "${REMOTE_LOGS[@]}"; do
    name="$(basename "$path")"
    [[ -f "$LOCAL_DIR/$name" ]] || continue
    echo "===== $name (last $TAIL_N lines) ====="
    tail -n "$TAIL_N" "$LOCAL_DIR/$name"
    echo ""
  done
fi
