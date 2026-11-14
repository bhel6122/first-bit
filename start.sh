#!/usr/bin/env bash
# first-bit. No build step; pdfjs-dist is the only (optional) dependency,
# needed only when uploading PDFs as course materials.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules/pdfjs-dist ]; then
  echo "提示：未安装 pdfjs-dist，上传 PDF 会提示改用粘贴文字。需要时运行: npm install pdfjs-dist"
fi

NODE=${NODE:-node}
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "node not found; set NODE=/path/to/node"
  exit 1
fi

# The server also reads .env.local itself; this keeps `PORT=... ./start.sh` working.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

PORT=${PORT:-5200}
echo "first-bit on http://localhost:$PORT"
exec "$NODE" app/server.mjs
