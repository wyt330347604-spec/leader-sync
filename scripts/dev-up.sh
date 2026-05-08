#!/usr/bin/env bash
# Local "dev up": ensures SSH tunnel to server dev DB is open, then pushes
# drizzle schema and seeds fixtures.
#
# Server dev stack must be running first (one-time):
#   pnpm run server:dev:up   (or:  bash scripts/server-dev-up.sh)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Ensure tunnel
echo "→ Ensuring SSH tunnel to server dev DB"
bash scripts/dev-tunnel.sh up

# 2. Wait for postgres reachable through tunnel
echo "→ Probing postgres on localhost:5432 (via tunnel)"
for i in {1..15}; do
  if (echo > /dev/tcp/localhost/5432) 2>/dev/null; then
    echo "  ✓ port 5432 open"
    break
  fi
  sleep 1
  if [[ $i -eq 15 ]]; then
    echo "✗ Cannot reach localhost:5432. Is the tunnel really up?"
    exit 1
  fi
done

# 3. drizzle-kit push (sync schema to dev DB)
echo "→ drizzle-kit push (sync schema to leader_sync_dev)"
( cd db && DATABASE_URL="postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev" \
    pnpm exec drizzle-kit push --force 2>&1 | tail -10 )

# 4. Seed fixtures
echo "→ Seeding fixtures"
( cd db && DATABASE_URL="postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev" \
    pnpm exec tsx seed/fixtures.ts )

echo ""
echo "✓ Local dev environment ready"
echo "  • DB connected via tunnel: localhost:5432 → server :5433"
echo "  • Schema pushed + fixtures seeded"
echo ""
echo "Now in two terminals:"
echo "  T1:  NODE_ENV=development DATABASE_URL='postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' pnpm --filter @leader-sync/api dev"
echo "  T2:  pnpm --filter @leader-sync/web dev"
echo ""
echo "Then capture screenshots:"
echo "       cd apps/web && pnpm e2e:screenshot"
