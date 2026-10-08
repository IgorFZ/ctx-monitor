#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { configDir, command } = require('./config');
const { sync } = require('./sync');

try {
  const file = path.join(configDir(), 'settings.json');
  const exists = fs.existsSync(file);
  const source = exists ? fs.readFileSync(file, 'utf8') : '{}';
  const settings = JSON.parse(source);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('settings.json deve conter um objeto JSON');
  }
  const keys = ['statusLine', 'subagentStatusLine'];
  const conflicts = keys.filter((key) => settings[key] && !settings[key].command?.includes('ctx-monitor'));
  if (conflicts.length && !process.argv.includes('--replace')) {
    throw new Error(`Configuração existente em ${conflicts.join(', ')}. Use --replace para substituir as duas barras. Nenhuma configuração foi alterada.`);
  }
  sync();
  settings.statusLine = { type: 'command', command: command('statusline.js'), refreshInterval: 1 };
  settings.subagentStatusLine = { type: 'command', command: command('subagent-statusline.js') };
  if (exists) {
    const backup = `${file}.ctx-monitor-${Date.now()}.bak`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    console.log(`Backup: ${backup}`);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log('ctx-monitor: barras principal e dos subagentes configuradas.');
} catch (error) {
  console.error(`ctx-monitor: ${error.message}`);
  process.exitCode = 1;
}
