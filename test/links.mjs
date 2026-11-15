import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { categorize, collectMessages, createCollection, displayTitle, groupLinks, markdownLinks, normalizeUrl, MAX_LINKS } from '../plugins/ctx-monitor/scripts/links-core.mjs';

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
assert.match(markdownLinks([]), /No links/);
assert.match(markdownLinks(messages), /\*\*Pull requests\*\* \(1\)/);

const kinds = {
  'https://github.com/acme/app/pull/12': ['pr', 'acme/app#12'],
  'https://github.com/acme/app/pull/new/feat/x': ['branch', 'feat/x'],
  'https://github.com/acme/app/issues/3': ['issue', 'acme/app#3'],
  'https://github.com/acme/app/tree/feat/x': ['branch', 'feat/x'],
  'https://github.com/acme/app/commit/abcdef1234567890': ['commit', 'abcdef123456'],
  'https://github.com/acme/app/actions/runs/77/job/9': ['ci', 'acme/app run 77'],
  'https://github.com/acme/app/blob/main/src/a.ts': ['code', 'acme/app: src/a.ts'],
  'https://gitlab.com/g/p/-/merge_requests/4': ['pr', 'g/p#4'],
  'https://dev.azure.com/o/p/_git/repo/pullrequest/77': ['pr', 'repo#77'],
  'https://acme.atlassian.net/browse/ERP-12': ['issue', 'ERP-12'],
  'https://docs.python.org/3/': ['docs', ''],
  'http://localhost:3000/': ['local', ''],
  'https://example.com/x': ['other', ''],
};
for (const [url, [category, ref]] of Object.entries(kinds)) {
  assert.deepEqual(categorize({ url, source: 'Bash' }), { category, ref }, url);
}
assert.equal(categorize({ url: 'https://blog.example.com/post', source: 'WebSearch' }).category, 'search');
assert.deepEqual(groupLinks([{ url: 'https://example.com/a', title: '', source: 'Bash' }, { url: 'https://github.com/a/b/pull/1', title: '', source: 'Bash' }]).map(g => g.id), ['pr', 'other']);
assert.equal(displayTitle({ url: 'https://github.com/a/b/pull/1', title: 'github.com', source: 'Bash' }), 'a/b#1');
assert.equal(displayTitle({ url: 'https://example.com/docs/x/', title: 'example.com', source: 'Bash' }), 'example.com/docs/x');
assert.equal(displayTitle({ url: 'https://example.com/', title: 'Example', source: 'Bash' }), 'Example');

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
  assert.match(run('links.js', ['one']).stdout, /No links/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('OK: extraction, deduplication and local per-session link reading');
