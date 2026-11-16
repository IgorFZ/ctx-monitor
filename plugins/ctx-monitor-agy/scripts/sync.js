#!/usr/bin/env node
// Copies standalone renderers and shared helpers to ~/.gemini/antigravity-cli/ctx-monitor.
const fs = require('fs');
const path = require('path');
const { configDir } = require('./config');

function sync() {
  const dest = path.join(configDir(), 'ctx-monitor');
  const sharedDir = path.resolve(__dirname, '../../../shared');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'statusline.js'), path.join(dest, 'statusline.js'));
  for (const file of ['format.js', 'ai-memory.js', 'status-core.js']) {
    fs.copyFileSync(path.join(sharedDir, file), path.join(dest, file));
  }
}

if (require.main === module) {
  try { sync(); } catch (error) {
    process.stderr.write(`ctx-monitor-agy sync failed: ${error.message}\n`);
  }
}

module.exports = { sync };
