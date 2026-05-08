#!/usr/bin/env bash
# Reset server-side dev DB volume (data wiped) and re-seed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SSH_KEY="${SSH_KEY:-$HOME/Documents/AI-APP/task-manger/Harvey.pem}"
HOST="${LEADER_SYNC_HOST:-root@47.84.35.154}"
REMOTE_DIR="${LEADER_SYNC_DEV_DIR:-/opt/leader-sync-dev}"

echo "→ Closing tunnel (if any)"
bash scripts/dev-tunnel.sh down || true

echo "→ Wiping server dev volume"
ssh -i "$SSH_KEY" "$HOST" "cd $REMOTE_DIR && docker compose down -v && docker compose up -d"

echo "→ Waiting for healthy"
for i in {1..60}; do
  status=$(ssh -i "$SSH_KEY" "$HOST" "docker inspect --format '{{.State.Health.Status}}' leader-sync-dev-postgres-dev-1 2>/dev/null || echo 'starting'")
  if [[ "$status" == "healthy" ]]; then break; fi
  sleep 1
done

bash scripts/dev-up.sh
