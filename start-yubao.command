#!/bin/bash
set -e
cd "$(dirname "$0")"

if command -v node >/dev/null 2>&1; then
  exec node server.mjs
fi

BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -x "$BUNDLED_NODE" ]; then
  exec "$BUNDLED_NODE" server.mjs
fi

echo "未找到 Node.js 20 或更高版本。" >&2
exit 1
