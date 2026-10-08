const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scripts = path.resolve(__dirname, '../plugins/ctx-monitor/scripts');
const { clean, width } = require(path.join(scripts, 'format'));
const env = { ...process.env, CTX_MONITOR_AIMEMORY: '0', COLUMNS: '120' };
delete env.CLAUDE_PLUGIN_ROOT;
const render = (script, data, extra = {}) => {
  const result = spawnSync(process.execPath, [path.join(scripts, script)], {
    input: typeof data === 'string' ? data : JSON.stringify(data), encoding: 'utf8', env: { ...env, ...extra },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
};
const main = {
  model: { display_name: 'Opus 5.5 [1M context]' }, effort: { level: 'high' },
  context_window: { used_percentage: 52, total_input_tokens: 518000, context_window_size: 1000000 },
  prompt_cache: { caching_observed: true, warm: true, expires_at: Date.now() / 1000 + 3600, hit_ratio: .98, misses: 3 },
};
let lines = render('statusline.js', main).split('\n').map(clean);
assert.equal(lines.length, 2);
assert.match(lines[0], /^Opus 5.5 · high \| ctx .*52% · 518k\/1M$/);
assert.match(lines[1], /^cache \d+:\d+ · hit 98% · misses 3$/);
assert.ok(!lines.join('').includes('ttl_expired'));
const expired = render('statusline.js', { ...main, prompt_cache: { ...main.prompt_cache, expires_at: 1 } });
assert.match(clean(expired), /cache frio/);
assert.ok(!clean(expired).includes('00:00'));
assert.equal(render('statusline.js', 'invalid'), '');
assert.equal(render('statusline.js', 'null'), '');
assert.match(clean(render('statusline.js', {})), /ctx --/);
assert.equal(render('statusline.js', main, { CTX_MONITOR_CACHE: '0' }).split('\n').length, 1);
for (const columns of [1, 20, 60, 80, 120]) {
  for (const line of render('statusline.js', main, { COLUMNS: String(columns) }).split('\n')) {
    assert.ok(width(line) <= columns);
  }
}
const tasks = [
  { id: 'one', agentType: 'Explore', model: 'claude-haiku-5-5', effort: 'low', tokenCount: 42000, contextWindowSize: 200000, label: 'Inspecting logs' },
  { id: 'two', name: 'reviewer', model: 'claude-sonnet-5-5', effort: 0, tokenCount: 505000, contextWindowSize: 200000 },
  { id: 'three', tokenCount: 0 },
];
for (const columns of [1, 20, 60, 90, 120]) {
  const rows = render('subagent-statusline.js', { columns, tasks }).split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.id), ['one', 'two', 'three']);
  for (const row of rows) assert.ok(width(row.content) <= columns);
  if (columns === 120) {
    assert.match(clean(rows[0].content), /Explore.*haiku-5-5 · low.*~21% · 42k\/200k.*Inspecting logs/);
    assert.match(clean(rows[1].content), /~252%/);
    assert.match(clean(rows[2].content), /tokens 0/);
  }
}
assert.equal(render('subagent-statusline.js', 'invalid'), '');
assert.equal(render('subagent-statusline.js', { tasks: [] }), '');
assert.equal(render('subagent-statusline.js', { tasks: [null, {}] }), '');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-monitor test '));
try {
  const configDir = path.join(temp, 'config with spaces');
  fs.mkdirSync(configDir);
  const file = path.join(configDir, 'settings.json');
  const original = JSON.stringify({ statusLine: { type: 'command', command: 'old-main' }, subagentStatusLine: { type: 'command', command: 'old-agent' }, env: { KEEP: 'yes' } });
  fs.writeFileSync(file, original);
  const setup = (args = []) => spawnSync(process.execPath, [path.join(scripts, 'setup.js'), ...args], {
    encoding: 'utf8', env: { ...env, CLAUDE_CONFIG_DIR: configDir },
  });
  assert.equal(setup().status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(setup(['--replace']).status, 0);
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(settings.env, { KEEP: 'yes' });
  const backups = fs.readdirSync(configDir).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(configDir, backups[0]), 'utf8'), original);
  for (const [key, input] of [['statusLine', main], ['subagentStatusLine', { columns: 120, tasks }]]) {
    const result = spawnSync(settings[key].command, { shell: true, cwd: temp, input: JSON.stringify(input),
      encoding: 'utf8', env: { ...env, CLAUDE_CONFIG_DIR: configDir } });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
    if (key === 'subagentStatusLine') assert.equal(result.stdout.trim().split('\n').map(JSON.parse).length, 3);
  }
  const plugin = JSON.parse(fs.readFileSync(path.resolve(scripts, '../settings.json'), 'utf8'));
  assert.equal(plugin.subagentStatusLine.command, settings.subagentStatusLine.command);
  assert.equal(setup().status, 0);
  fs.writeFileSync(file, '{broken');
  assert.equal(setup(['--replace']).status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('OK: renderização, limites de largura e configuração das duas barras');
