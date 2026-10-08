#!/usr/bin/env node
// Copia os renderizadores para um caminho que não muda a cada update do plugin.
const fs = require('fs');
const path = require('path');
const { configDir } = require('./config');

function sync() {
  const dest = path.join(configDir(), 'ctx-monitor');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of ['statusline.js', 'subagent-statusline.js', 'format.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(dest, file));
  }
}

if (require.main === module) {
  try { sync(); } catch (error) {
    // Uma falha no hook não deve impedir a sessão de abrir.
    process.stderr.write(`ctx-monitor sync falhou: ${error.message}\n`);
  }
}
module.exports = { sync };
