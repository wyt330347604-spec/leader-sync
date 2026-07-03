#!/usr/bin/env bash
# 每日数据库备份：pg_dump（容器内执行）→ gzip → /var/backups/leader-sync，保留 14 天。
# 由 leader-backup.timer 触发（每天 03:30 服务器本地时间）。
set -euo pipefail
cd /opt/leader-sync

DBURL=$(grep '^DATABASE_URL' .env | cut -d= -f2-)
DIR=/var/backups/leader-sync
mkdir -p "$DIR"
STAMP=$(date +%F_%H%M)
OUT="$DIR/leader_sync_$STAMP.sql.gz"

docker exec leader-sync-postgres-1 pg_dump "$DBURL" | gzip > "$OUT"

# 空备份视为失败（管道里 pg_dump 挂了 gzip 也会产出文件头）
if [ "$(stat -c%s "$OUT")" -lt 10240 ]; then
  echo "backup TOO SMALL: $OUT" >&2
  exit 1
fi

find "$DIR" -name 'leader_sync_*.sql.gz' -mtime +14 -delete
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
