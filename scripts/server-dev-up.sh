#!/usr/bin/env bash
# One-time bring-up of the dev stack ON THE SERVER (postgres + redis on
# 127.0.0.1:5433 / :6380). Idempotent.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_KEY="${SSH_KEY:-$HOME/Documents/AI-APP/task-manger/Harvey.pem}"
HOST="${LEADER_SYNC_HOST:-root@47.84.35.154}"
REMOTE_DIR="${LEADER_SYNC_DEV_DIR:-/opt/leader-sync-dev}"

echo "→ Pushing docker-compose.dev.yml to ${HOST}:${REMOTE_DIR}/docker-compose.yml"
ssh -i "$SSH_KEY" "$HOST" "mkdir -p $REMOTE_DIR"
rsync -az -e "ssh -i $SSH_KEY" "$REPO_ROOT/docker-compose.dev.yml" "$HOST:$REMOTE_DIR/docker-compose.yml"

echo "→ docker compose up -d (dev stack)"
ssh -i "$SSH_KEY" "$HOST" "cd $REMOTE_DIR && docker compose up -d"

echo "→ Waiting for postgres-dev healthy"
for i in {1..60}; do
  status=$(ssh -i "$SSH_KEY" "$HOST" "docker inspect --format '{{.State.Health.Status}}' leader-sync-dev-postgres-dev-1 2>/dev/null || echo 'starting'")
  if [[ "$status" == "healthy" ]]; then
    echo "  ✓ postgres-dev ready"
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "✗ postgres-dev did not become healthy in 60s"
    ssh -i "$SSH_KEY" "$HOST" "docker compose -f $REMOTE_DIR/docker-compose.yml logs postgres-dev | tail -30"
    exit 1
  fi
done

echo ""
echo "✓ Server dev stack up:"
ssh -i "$SSH_KEY" "$HOST" "docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep leader-sync-dev"
echo ""
echo "Next steps (on local machine):"
echo "  pnpm dev:tunnel        # forward 5433/6380 from server → local 5432/6379"
echo "  pnpm dev:up            # apply schema + seed fixtures (via tunnel)"
echo "  NODE_ENV=development pnpm --filter @leader-sync/api dev"
echo "  pnpm --filter @leader-sync/web dev"
