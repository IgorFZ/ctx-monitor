const os = require('os');
const path = require('path');
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Node resolves the directory itself: works with spaces in the path and does not
// depend on CLAUDE_PLUGIN_ROOT being expanded in the plugin settings.
const command = (script) => `node -e "require(require('path').join(process.env.CLAUDE_CONFIG_DIR || require('path').join(require('os').homedir(), '.claude'), 'ctx-monitor', '${script}'))"`;
module.exports = { configDir, command };
