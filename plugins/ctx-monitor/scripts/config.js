const os = require('os');
const path = require('path');
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// O próprio Node resolve o diretório: funciona com espaços no caminho e sem
// depender da expansão de CLAUDE_PLUGIN_ROOT nas settings do plugin.
const command = (script) => `node -e "require(require('path').join(process.env.CLAUDE_CONFIG_DIR || require('path').join(require('os').homedir(), '.claude'), 'ctx-monitor', '${script}'))"`;
module.exports = { configDir, command };
