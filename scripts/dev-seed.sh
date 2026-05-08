#!/usr/bin/env bash
# Reseed fixtures only — assumes tunnel is up.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/db"

DATABASE_URL="postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev" \
  pnpm exec tsx seed/fixtures.ts
