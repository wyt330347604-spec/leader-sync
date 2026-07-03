#!/usr/bin/env bash
# 健康检查：API(3001)/Web(3000)/公网 HTTPS 任一失败 → 飞书私聊告警（30 分钟冷却）。
# 由 leader-healthcheck.timer 每 5 分钟触发。局限：整机宕机时本检查也随之失效。
set -uo pipefail
cd /opt/leader-sync

ALERT_OPEN_ID="ou_1c419560953e219d5876918a2b934dfb"  # Harvey/王永涛
COOLDOWN_FILE=/tmp/leader-healthcheck.last
COOLDOWN_SECS=1800

FAILS=""
curl -sf --max-time 10 http://127.0.0.1:3001/healthz >/dev/null || FAILS="$FAILS API(3001)"
curl -sf --max-time 10 -o /dev/null http://127.0.0.1:3000 || FAILS="$FAILS Web(3000)"
curl -sf --max-time 15 -o /dev/null https://www.harveywang.xyz/healthz || FAILS="$FAILS 公网HTTPS"

if [ -z "$FAILS" ]; then
  rm -f "$COOLDOWN_FILE"
  exit 0
fi
echo "health FAIL:$FAILS"

now=$(date +%s)
if [ -f "$COOLDOWN_FILE" ]; then
  last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$COOLDOWN_SECS" ]; then
    echo "in cooldown, skip alert"
    exit 0
  fi
fi
echo "$now" > "$COOLDOWN_FILE"

APP_ID=$(grep '^FEISHU_APP_ID' .env | cut -d= -f2-)
APP_SECRET=$(grep '^FEISHU_APP_SECRET' .env | cut -d= -f2-)
TOKEN=$(curl -s --max-time 15 -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H 'Content-Type: application/json' \
  -d "{\"app_id\":\"$APP_ID\",\"app_secret\":\"$APP_SECRET\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tenant_access_token",""))' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "alert token fetch failed" >&2
  exit 1
fi

MSG="⚠️ 督办系统健康检查失败：$FAILS （$(date '+%m-%d %H:%M')，服务器 47.84.35.154）"
curl -s --max-time 15 -X POST 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"receive_id\":\"$ALERT_OPEN_ID\",\"msg_type\":\"text\",\"content\":\"{\\\"text\\\":\\\"$MSG\\\"}\"}" >/dev/null
echo "alert sent"
