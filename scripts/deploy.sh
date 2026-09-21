#!/usr/bin/env bash
# agent-talk 发版部署：rsync 代码 → 服务器构建（系统 node）→ pm2 平滑重启（node24 interpreter）→ 健康检查
# 用法：npm run deploy（或 bash scripts/deploy.sh）
# 拓扑与坑详见 docs/deploy.md；服务器 web@82.156.141.195:/home/web/code/agent_talk
set -euo pipefail

SERVER="${DEPLOY_SERVER:-web@82.156.141.195}"
REMOTE_DIR="${DEPLOY_DIR:-/home/web/code/agent_talk}"
PM2_APP="${PM2_APP:-agent-talk}"
PORT="${DEPLOY_PORT:-38711}"
PUBLIC_URL="${PUBLIC_URL:-https://roundtable.ctrlacv.com}"

cd "$(git rev-parse --show-toplevel)"

# ── ① 版本信息与工作区检查 ──────────────────────────────────────────
COMMIT="$(git rev-parse --short HEAD)"
TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
echo "▸ 部署 ${TAG:-（未打 tag）} @ ${COMMIT} → ${SERVER}:${REMOTE_DIR}"
if [ -n "$(git status --short)" ]; then
  echo "⚠ 工作区有未提交改动，以下内容将一并同步："
  git status --short
fi

# ── ② 同步代码 ──────────────────────────────────────────────────────
# 排除项说明见 docs/deploy.md 坑表：
#   *.tsbuildinfo 必须排除——增量缓存会让服务器 build 静默跳过产出（Script not found 坑）
#   roundtables / roundtable_data / .roundtable / .kanban 等为运行时或本机私有数据，不入服务器
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude '*.tsbuildinfo' \
  --exclude roundtable_data --exclude roundtables \
  --exclude .roundtable --exclude .codegraph --exclude .kanban \
  --exclude .git --exclude .DS_Store \
  ./ "${SERVER}:${REMOTE_DIR}/"
echo "▸ 代码同步完成"

# ── ③ 服务器构建 + 平滑重启 + 本机健康检查 ─────────────────────────
ssh -o BatchMode=yes "$SERVER" bash -s <<EOF
set -euo pipefail
command -v pm2 >/dev/null || { echo "✗ 服务器上找不到 pm2"; exit 1; }
cd ${REMOTE_DIR}
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf http://127.0.0.1:${PORT}/healthz >/dev/null; then
    echo "▸ 服务器本机健康检查通过（127.0.0.1:${PORT}）"
    exit 0
  fi
done
echo "✗ 健康检查失败，最近日志："
pm2 logs ${PM2_APP} --lines 20 --nostream
exit 1
EOF

# ── ④ 公网验证 ──────────────────────────────────────────────────────
if curl -sf "${PUBLIC_URL}/healthz" >/dev/null; then
  echo "▸ 公网健康检查通过：${PUBLIC_URL}/healthz"
else
  echo "✗ 公网健康检查失败：${PUBLIC_URL}/healthz（服务器本机已通，查 nginx/证书/DNS）"
  exit 1
fi

echo "✓ 部署完成：${TAG:-${COMMIT}} 已上线 ${PUBLIC_URL}（pm2: ${PM2_APP}，数据目录 /data/agent_talk 不受影响）"
