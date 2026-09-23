#!/bin/zsh
# 用本机 Chrome 的无头模式真实跑一遍界面自检（?selftest=1 会模拟点击整个流程），
# 并顺便截一张图。用法：scripts/selftest.sh [截图输出路径]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8791}"
WIDTH="${WIDTH:-430}"
HEIGHT="${HEIGHT:-932}"
TAB="${TAB:-budget}"
MONTH="${MONTH:-}"
MODE="${MODE:-http}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SHOT="${1:-/tmp/budget-web-screenshot.png}"

if [ ! -x "$CHROME" ]; then
  echo "找不到 Chrome，跳过界面自检"
  exit 0
fi

PROFILE="$(mktemp -d)/chrome-profile"
# 截图用另一份配置目录，避免被自检留下的数据影响，能看到干净的示例数据
PROFILE_SHOT="$(mktemp -d)/chrome-profile-shot"

if [ "$MODE" = "file" ]; then
  # 直接双击打开本地 HTML 文件的情况
  BASE_URL="file://$ROOT/index.html"
else
  BASE_URL="http://127.0.0.1:$PORT/index.html"
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/tmp/budget-web-server.log 2>&1 &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$(dirname "$PROFILE")" "$(dirname "$PROFILE_SHOT")" 2>/dev/null || true' EXIT INT TERM
  sleep 1
fi

# 无头 Chrome 偶尔不自己退出，这里兜一个超时，避免脚本卡死。
run_chrome() {
  local profile="$1"
  shift
  "$CHROME" --headless=new --disable-gpu --no-sandbox --no-proxy-server \
    --user-data-dir="$profile" --hide-scrollbars "$@" &
  local chrome_pid=$!
  local waited=0
  while kill -0 "$chrome_pid" 2>/dev/null && [ "$waited" -lt 40 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill -0 "$chrome_pid" 2>/dev/null && kill -9 "$chrome_pid" 2>/dev/null
  wait "$chrome_pid" 2>/dev/null || true
}

run_chrome "$PROFILE" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=6000 \
  --dump-dom "$BASE_URL?selftest=1" \
  > /tmp/budget-web-dom.html 2>/tmp/budget-web-chrome.log

# 重新打开一次，确认数据真的保存在本机（同一个 Chrome 配置目录 = 同一个浏览器）。
run_chrome "$PROFILE" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=3000 \
  --dump-dom "$BASE_URL?selftest=persist" \
  > /tmp/budget-web-dom-persist.html 2>>/tmp/budget-web-chrome.log

SHOT_QUERY="sample=1&tab=$TAB"
if [ -n "$MONTH" ]; then SHOT_QUERY="$SHOT_QUERY&month=$MONTH"; fi

run_chrome "$PROFILE_SHOT" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=4000 \
  --screenshot="$SHOT" "$BASE_URL?$SHOT_QUERY" \
  >/dev/null 2>>/tmp/budget-web-chrome.log

# 如果指定了 SHEET，再截一张表单的图（例如 SHEET=item 看「按天重复」表单）
if [ -n "${SHEET:-}" ]; then
  run_chrome "$PROFILE_SHOT" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=4000 \
    --screenshot="${SHOT%.png}-$SHEET.png" "$BASE_URL?sample=1&sheet=$SHEET" \
    >/dev/null 2>>/tmp/budget-web-chrome.log
fi

# —— 离线验证：先等 Service Worker 装好，再把服务停掉，看页面还能不能打开 ——
OFFLINE_RESULT=""
if [ "$MODE" != "file" ]; then
  run_chrome "$PROFILE" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=5000 \
    --dump-dom "$BASE_URL?sample=1" > /dev/null 2>>/tmp/budget-web-chrome.log
  kill "$SERVER_PID" 2>/dev/null || true
  sleep 1
  run_chrome "$PROFILE" --window-size="$WIDTH","$HEIGHT" --virtual-time-budget=5000 \
    --dump-dom "$BASE_URL?offline=1" > /tmp/budget-web-offline.html 2>>/tmp/budget-web-chrome.log
  OFFLINE_RESULT="$(python3 - <<'PY'
import re
try:
    dom = open('/tmp/budget-web-offline.html', encoding='utf-8').read()
except FileNotFoundError:
    dom = ''
match = re.search(r'<pre class="selftest"[^>]*>(.*?)</pre>', dom, re.S)
print(match.group(1) if match else '服务停掉后页面打不开了（没有离线缓存）')
PY
)"
fi

python3 - "$SHOT" "$OFFLINE_RESULT" <<'PY'
import re, sys

def unescape(text):
    return text.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"')

def extract(path, cls):
    dom = open(path, encoding='utf-8').read()
    match = re.search(r'<pre class="' + cls + r'"[^>]*>(.*?)</pre>', dom, re.S)
    return unescape(match.group(1)) if match else None

phase1 = extract('/tmp/budget-web-dom.html', 'selftest')
phase2 = extract('/tmp/budget-web-dom-persist.html', 'selftest')
if phase1 is None:
    print('未找到自检输出，可能页面报错了。Chrome 日志：/tmp/budget-web-chrome.log')
    sys.exit(1)
print('—— 交互流程 ——')
print(phase1)
print()
print('—— 重开后数据是否还在 ——')
print(phase2 if phase2 is not None else '（第二阶段没有输出）')
print()
offline = sys.argv[2] if len(sys.argv) > 2 else ''
if offline:
    print('—— 把服务停掉后，页面还能打开吗 ——')
    print(offline)
    print()
fails = [line for line in (phase1 + '\n' + (phase2 or '')).splitlines() if line.startswith('FAIL')]
if offline and 'OFFLINE OK' not in offline:
    fails.append('断网后无法打开（离线缓存没生效）')
print()
print('截图：' + sys.argv[1])
if fails:
    print('自检失败 %d 项' % len(fails))
    sys.exit(1)
print('界面自检全部通过')
PY
