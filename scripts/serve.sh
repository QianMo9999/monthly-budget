#!/bin/zsh
# 不用部署：在局域网里把「月账本」跑起来，手机连同一个 WiFi 就能打开。
# 用法：scripts/serve.sh [端口]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-${PORT:-8800}}"
LOG="${TMPDIR:-/tmp}/monthly-budget-server.log"

pkill -f "http.server $PORT" 2>/dev/null || true

nohup python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$ROOT" >"$LOG" 2>&1 &
disown 2>/dev/null || true
sleep 1

HOST="$(scutil --get LocalHostName 2>/dev/null || true)"
IP="$(ifconfig 2>/dev/null | awk '/inet 192\.|inet 10\.|inet 172\./ {print $2; exit}')"

echo "月账本已在后台运行（日志：$LOG）"
echo
if [ -n "$IP" ]; then
  echo "  手机上打开：  http://$IP:$PORT"
fi
if [ -n "$HOST" ]; then
  echo "  更稳的地址：  http://$HOST.local:$PORT   ← IP 变了也能用，建议用这个"
fi
echo
echo "  停止服务：    pkill -f 'http.server $PORT'"
