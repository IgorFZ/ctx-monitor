const os = require('os');
const path = require('path');

function configDir() {
  return process.env.AGY_CONFIG_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

function command(file) {
  const escaped = file.replace(/['\\]/g, '\\$&');
  return `node -e "require(require('path').join(process.env.AGY_CONFIG_DIR || require('path').join(require('os').homedir(), '.gemini', 'antigravity-cli'), 'ctx-monitor', '${escaped}'))"`;
}

module.exports = { configDir, command };
