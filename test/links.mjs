import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCollection, collectMessages, markdownLinks, normalizeUrl, MAX_LINKS } from '../plugins/ctx-monitor/scripts/links-core.mjs';

const links = createCollection();
links.scan('[Documentation](https://example.com/docs). https://example.com/docs https://example.com/path_(nested).', 'Claude');
links.scan({ title: 'Fix cache', url: 'https://github.com/acme/app/pull/12' }, 'Bash');
links.scan('{"title":"Issue title","html_url":"https://github.com/acme/app/issues/2"}', 'MCP');
assert.equal(links.list().length, 4);
assert.equal(links.list().find(link => link.url.endsWith('/docs')).title, 'Documentation');
assert.ok(links.list().some(link => link.url.endsWith('path_(nested)')));
assert.equal(links.list()[0].title, 'Issue title');
assert.equal(normalizeUrl('https://user:password@example.com/private'), null);
assert.equal(normalizeUrl('javascript:alert(1)'), null);
assert.equal(normalizeUrl('https://example.com/\nBAD'), null);
links.scan('#123 HUB-123', 'Claude');
assert.equal(links.list().length, 4);
const bounded = createCollection();
for (let i = 0; i < MAX_LINKS + 5; i++) bounded.scan(`https://example.com/${i}`);
assert.equal(bounded.list().length, MAX_LINKS);
assert.ok(!bounded.list().some(link => link.url.endsWith('/0')));
const messages = collectMessages([
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Bash' }] },
  { role: 'user', text: '', toolResults: [{ tool_use_id: 'a', text: 'https://github.com/acme/app/pull/12' }] },
]);
assert.equal(messages[0].source, 'Bash');
assert.match(markdownLinks(messages), /https:\/\/github.com\/acme\/app\/pull\/12/);
assert.match(markdownLinks([]), /Nenhum link/);

const scripts = path.resolve('plugins/ctx-monitor/scripts');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-monitor-links-'));
try {
  const config = path.join(temp, 'config');
  const transcript = path.join(temp, 'session.jsonl');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  const run = (file, args = [], input = '') => spawnSync(process.execPath, [path.join(scripts, file), ...args], { env, input, encoding: 'utf8' });
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '[Docs](https://example.com/docs)' }, { type: 'tool_use', id: 'a', name: 'Bash' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'https://github.com/acme/app/pull/12' }] }] } }),
    '{partial',
  ].join('\n'));
  assert.equal(run('session-links.js', [], JSON.stringify({ session_id: 'one', transcript_path: transcript })).status, 0);
  const result = run('links.js', ['one']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Docs/);
  assert.match(result.stdout, /Bash/);
  assert.match(result.stdout, /\/pull\/12/);
  assert.equal(run('links.js', ['unknown']).status, 1);
  assert.equal(run('links.js', ['../../other']).status, 1);
  fs.writeFileSync(transcript, '');
  assert.match(run('links.js', ['one']).stdout, /Nenhum link/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('OK: extração, deduplicação e leitura local dos links por sessão');
