#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { configDir } = require('./config');

try {
  const dir = configDir();
  const file = path.join(dir, 'settings.json');
  if (fs.existsSync(file)) {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (settings.statusLine?.command?.includes('ctx-monitor')) {
      const backup = `${file}.ctx-monitor-${Date.now()}.bak`;
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      delete settings.statusLine;
      fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
      console.log(`Backup: ${backup}`);
      console.log('ctx-monitor-agy: statusLine removed from settings.json.');
    } else {
      console.log('ctx-monitor-agy: no ctx-monitor statusLine found in settings.json.');
    }
  }
  const dest = path.join(dir, 'ctx-monitor');
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`ctx-monitor-agy: ${error.message}`);
  process.exitCode = 1;
}
