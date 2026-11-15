import { expect, test } from 'claude-code/testing';

import { collectFiles, diffStat, hunksDiff, parseGitStatus, removedPaths, unifiedDiff } from '../../../hooks/session/files';

test('collects reads and writes, newest first, and marks removed files', () => {
  const files = collectFiles([{ role: 'assistant', text: '', toolUses: [
    { tool_use_id: '1', tool: 'Read', input: { file_path: '/p/a.ts' }, result: {} },
    { tool_use_id: '2', tool: 'Edit', input: { file_path: '/p/a.ts' }, result: { originalFile: 'x\n', structuredPatch: [] } },
    { tool_use_id: '3', tool: 'Edit', input: { file_path: '/p/a.ts' }, result: { originalFile: 'y\n', structuredPatch: [] } },
    { tool_use_id: '4', tool: 'Write', input: { file_path: '/p/b.ts' }, result: { type: 'create', originalFile: null, structuredPatch: [] } },
    { tool_use_id: '5', tool: 'Edit', input: { file_path: '/p/c.ts' }, result: 'error', isError: true },
    { tool_use_id: '6', tool: 'Bash', input: { command: 'npm test && rm -f b.ts' }, result: {} },
  ] }]);
  expect(files.map(f => [f.path, f.action, f.reads, f.writes])).toEqual([
    ['/p/b.ts', 'deleted', 0, 1],
    ['/p/a.ts', 'edited', 1, 2],
  ]);
  // The original is the content before the session's first write, not before the last.
  expect(files[1]?.original).toBe('x\n');
});

test('rm and git rm paths, skipping flags and globs', () => {
  expect(removedPaths('rm -rf dist build/*.js; git rm src/old.ts\nls')).toEqual(['dist', 'src/old.ts']);
  expect(removedPaths('echo rm x')).toEqual([]);
});

test('unified diff with context, merged hunks and stats', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const after = before.replace('line 2\n', 'line two\n').replace('line 18\n', '');
  const diff = unifiedDiff(before, after)!;
  expect(diff.split('\n').filter(l => l.startsWith('@@'))).toEqual(['@@ -1,5 +1,5 @@', '@@ -15,6 +15,5 @@']);
  expect(diffStat(diff)).toEqual({ added: 1, removed: 2 });
  expect(unifiedDiff('same\n', 'same\n')).toBe('');
  expect(unifiedDiff('', 'new\n')).toBe('@@ -0,0 +1,1 @@\n+new');
  expect(hunksDiff([{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-a', '+b'] }])).toBe('@@ -3,1 +3,1 @@\n-a\n+b');
});

test('git status paths, renames giving the new path', () => {
  expect(parseGitStatus(' M src/a.ts\0?? notes.md\0R  new.ts\0old.ts\0')).toEqual(['src/a.ts', 'notes.md', 'new.ts']);
});
