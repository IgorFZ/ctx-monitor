#!/usr/bin/env node
// Guarda somente o caminho do transcript, por sessão, para o comando de fallback.
const fs = require('fs');
const path = require('path');
const { configDir } = require('./config');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!/^[\w-]{1,128}$/.test(data.session_id) || typeof data.transcript_path !== 'string') return;
    const dir = path.join(configDir(), 'ctx-monitor', 'sessions');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, `${data.session_id}.json`), JSON.stringify({ transcript: data.transcript_path }), { mode: 0o600 });
  } catch (error) {
    process.stderr.write(`ctx-monitor links: ${error.message}\n`);
  }
});
