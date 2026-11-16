import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  extractUrlsFromParts,
  formatUsageBar,
  readMachineStats,
  summarizeSessionUsage,
} from '../plugins/ctx-monitor-opencode/src/telemetry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { clean, width } = require(path.join(root, 'shared/format.js'));

const agyScripts = path.join(root, 'plugins/ctx-monitor-agy/scripts');
const env = { ...process.env, CTX_MONITOR_AIMEMORY: '0', COLUMNS: '120' };

const renderAgy = (data, extra = {}) => {
  const res = spawnSync(process.execPath, [path.join(agyScripts, 'statusline.js')], {
    input: typeof data === 'string' ? data : JSON.stringify(data),
    encoding: 'utf8',
    env: { ...env, ...extra },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.trimEnd();
};

// 1. agy statusline normalization & rendering
const agyPayload = {
  sessionId: 'agy-1',
  modelName: 'Gemini 4 Hydrogen',
  thinking_level: 'medium',
  tokens: { input: 250000 },
  max_tokens: 1000000,
};
const agyOut = clean(renderAgy(agyPayload));
assert.match(agyOut, /^Gemini 4 Hydrogen · medium \| ctx .*25% · 250k\/1M$/);

for (const cols of [20, 60, 120]) {
  for (const line of renderAgy(agyPayload, { COLUMNS: String(cols) }).split('\n')) {
    assert.ok(width(line) <= cols);
  }
}

// 2. agy setup, sync, and uninstall
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-monitor-agy-'));
try {
  const agyDir = path.join(tmp, 'agy');
  fs.mkdirSync(agyDir);
  const settingsFile = path.join(agyDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'other' }, theme: 'dark' }));

  const runSetup = (args = []) => spawnSync(process.execPath, [path.join(agyScripts, 'setup.js'), ...args], {
    encoding: 'utf8',
    env: { ...env, AGY_CONFIG_DIR: agyDir },
  });
  assert.equal(runSetup().status, 1);
  assert.equal(runSetup(['--replace']).status, 0);

  const updated = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(updated.theme, 'dark');
  assert.ok(updated.statusLine.command.includes('ctx-monitor'));
  assert.ok(fs.existsSync(path.join(agyDir, 'ctx-monitor/statusline.js')));
  assert.ok(fs.existsSync(path.join(agyDir, 'ctx-monitor/status-core.js')));

  const runUninstall = spawnSync(process.execPath, [path.join(agyScripts, 'uninstall.js')], {
    encoding: 'utf8',
    env: { ...env, AGY_CONFIG_DIR: agyDir },
  });
  assert.equal(runUninstall.status, 0, runUninstall.stderr);
  const afterUninstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(afterUninstall.statusLine, undefined);
  assert.equal(fs.existsSync(path.join(agyDir, 'ctx-monitor')), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. OpenCode telemetry helpers
const summary = summarizeSessionUsage(
  [
    { role: 'user' },
    { role: 'assistant', providerID: 'anthropic', modelID: 'claude-sonnet', cost: 0.12, tokens: { input: 30000, output: 5000, cache: { read: 15000 } } },
  ],
  [{ id: 'anthropic', models: { 'claude-sonnet': { limit: { context: 200000 } } } }],
);
assert.equal(summary.model, 'claude-sonnet');
assert.equal(summary.usedTokens, 50000);
assert.equal(summary.percentage, 25);
assert.equal(summary.costUsd, 0.12);
assert.match(formatUsageBar(summary.percentage), /^━━━─────── 25%$/);

const machine = readMachineStats();
assert.ok(machine.cpus >= 1);
assert.ok(machine.memUsedPct >= 0 && machine.memUsedPct <= 100);

const urls = extractUrlsFromParts([
  { text: 'Check https://github.com/IgorFZ/ctx-monitor.' },
  { state: { output: 'Docs at https://antigravity.google/docs/cli/reference,' } },
]);
assert.deepEqual(urls, ['https://github.com/IgorFZ/ctx-monitor', 'https://antigravity.google/docs/cli/reference']);

console.log('OK: agy statusline/setup/uninstall and opencode telemetry helpers');
