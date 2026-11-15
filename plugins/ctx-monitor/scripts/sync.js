#!/usr/bin/env node
// Copies the renderers to a path that does not change on each plugin update.
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
    // A hook failure must not keep the session from starting.
    process.stderr.write(`ctx-monitor sync failed: ${error.message}\n`);
  }
}
module.exports = { sync };
