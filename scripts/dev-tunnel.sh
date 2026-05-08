#!/usr/bin/env bash
# Manage SSH tunnel forwarding server's dev postgres/redis to local ports
# matching the .env (so DATABASE_URL=localhost:5432 just works).
#
# Usage:
#   scripts/dev-tunnel.sh up      # open in background
#   scripts/dev-tunnel.sh down    # close
#   scripts/dev-tunnel.sh status  # check
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/Documents/AI-APP/task-manger/Harvey.pem}"
HOST="${LEADER_SYNC_HOST:-root@47.84.35.154}"
PIDFILE="/tmp/leader-sync-dev-tunnel.pid"

ACTION="${1:-up}"

case "$ACTION" in
  up)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
      echo "✓ Tunnel already running (PID $(cat $PIDFILE))"
      exit 0
    fi
    # Check local ports free
    for port in 5432 6379; do
      if lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "✗ Local port $port is in use. Stop the conflicting service or close the existing tunnel:"
        lsof -i ":$port" -sTCP:LISTEN
        exit 1
      fi
    done
    echo "→ Opening SSH tunnel: localhost:5432 → ${HOST}:5433 (dev postgres)"
    echo "                       localhost:6379 → ${HOST}:6380 (dev redis)"
    ssh -i "$SSH_KEY" \
        -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=30 \
        -L 5432:localhost:5433 \
        -L 6379:localhost:6380 \
        -N -f "$HOST"
    # Find the pid (ssh -f forks; lsof gives the listener)
    sleep 1
    pid=$(lsof -i :5432 -sTCP:LISTEN -t | head -1 || echo "")
    if [[ -z "$pid" ]]; then
      echo "✗ Tunnel did not establish"
      exit 1
    fi
    echo "$pid" > "$PIDFILE"
    echo "✓ Tunnel up (PID $pid)"
    ;;
  down)
    if [[ -f "$PIDFILE" ]]; then
      pid=$(cat "$PIDFILE")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" && echo "✓ Tunnel down (PID $pid)"
      fi
      rm -f "$PIDFILE"
    else
      # Best-effort: kill any ssh forwarding our ports
      pkill -f "ssh.*-L 5432:localhost:5433" 2>/dev/null || true
      echo "✓ No tracked tunnel; killed any matching ssh forwarders"
    fi
    ;;
  status)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; then
      echo "✓ Tunnel running (PID $(cat $PIDFILE))"
      lsof -i :5432 -sTCP:LISTEN | head
    else
      echo "✗ No tunnel"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {up|down|status}"
    exit 1
    ;;
esac
