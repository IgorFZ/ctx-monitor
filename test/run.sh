#!/usr/bin/env bash
set -euo pipefail
# Evita consultar serviços locais ao rodar as entradas simuladas.
export CTX_MONITOR_AIMEMORY=0
cd "$(dirname "$0")/../plugins/ctx-monitor/scripts"
echo '{"model":{"display_name":"Opus"},"effort":{"level":"high"},"context_window":{"used_percentage":67,"total_input_tokens":134000,"context_window_size":200000}}' | node statusline.js
echo '{}' | node statusline.js
echo '{"columns":120,"tasks":[{"id":"a1","agentType":"Explore","status":"running","model":"claude-haiku-5-5","effort":"low","contextWindowSize":200000,"tokenCount":42000},{"id":"a2","status":"running","tokenCount":0}]}' | node subagent-statusline.js | while read -r l; do node -e 'JSON.parse(process.argv[1])' "$l"; done
echo "OK"
