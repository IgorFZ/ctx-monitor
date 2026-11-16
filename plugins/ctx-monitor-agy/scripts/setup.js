#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { configDir, command } = require('./config');
const { sync } = require('./sync');

try {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  const exists = fs.existsSync(file);
  const source = exists ? fs.readFileSync(file, 'utf8') : '{}';
  const settings = JSON.parse(source);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('settings.json must contain a JSON object');
  }
  if (settings.statusLine && !settings.statusLine.command?.includes('ctx-monitor') && !process.argv.includes('--replace')) {
    throw new Error('Existing configuration in statusLine. Use --replace to replace it. No settings were changed.');
  }
  sync();
  settings.statusLine = {
    type: 'command',
    command: command('statusline.js'),
    enabled: true,
    padding: 0,
    stack_with_default: false,
  };
  if (exists) {
    const backup = `${file}.ctx-monitor-${Date.now()}.bak`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    console.log(`Backup: ${backup}`);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log('ctx-monitor-agy: statusLine configured in settings.json.');
} catch (error) {
  console.error(`ctx-monitor-agy: ${error.message}`);
  process.exitCode = 1;
}
