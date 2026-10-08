#!/usr/bin/env node
// Copia os scripts do plugin para um caminho estável (~/.claude/ctx-monitor/).
// Motivo: o statusLine principal não pode ser declarado pelo plugin e precisa
// ficar no settings.json do usuário, mas ${CLAUDE_PLUGIN_ROOT} muda a cada update.
// Rodando no SessionStart, o caminho estável sempre aponta para a versão atual.
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = __dirname;
const dest = path.join(os.homedir(), '.claude', 'ctx-monitor');

try {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['statusline.js', 'subagent-statusline.js']) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
} catch (e) {
  // Nunca derrubar a sessão por causa disso
  process.stderr.write(`ctx-monitor sync falhou: ${e.message}\n`);
}
process.exit(0);
