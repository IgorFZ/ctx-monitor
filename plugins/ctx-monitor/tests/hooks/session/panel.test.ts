import type { On, RenderPropsOf, SessionMessage } from 'claude-code';
import { describe, expect, test } from 'claude-code/testing';

const messages: SessionMessage[] = [
  { role: 'assistant', text: '[Docs](https://example.com/docs)', toolUses: [
    { tool_use_id: 't1', tool: 'Bash', input: {}, result: { stdout: '{"title":"Fix cache","url":"https://github.com/acme/app/pull/12"}' } },
    { tool_use_id: 't2', tool: 'Read', input: { file_path: '/work/README.md' }, result: {} },
    { tool_use_id: 't3', tool: 'Edit', input: { file_path: '/work/src/app.ts' },
      result: { originalFile: 'const a = 1\nconst b = 2\n', structuredPatch: [] } },
    { tool_use_id: 't4', tool: 'Write', input: { file_path: '/work/src/new.ts' },
      result: { type: 'create', originalFile: null, structuredPatch: [] } },
  ] },
];
const disk: Record<string, string> = { '/work/src/app.ts': 'const a = 1\nconst b = 3\n', '/work/src/new.ts': 'export {}\n' };
// On Windows the engine hands fs calls a native path (C:\work\src\app.ts), so match by the end.
const onDisk = (path: string) => Object.keys(disk).find(key => path.replace(/\\/g, '/').endsWith(key));
const pane: RenderPropsOf['Pane'] = { isFocused: true, title: 'Session', bodyColumns: 86, placement: 'inline', scroll: { offset: 0, bodyRows: 24 }, view: {} };
const band: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} };

function beneath(on: On, opened: unknown[] = [], closed: unknown[] = []) {
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.cwd', () => ({ value: '/work' }));
  on('session.usage', () => ({ value: { context: { window: 200000 }, rateLimits: [], startedAt: 0 } }));
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('session.messages', () => ({ value: messages }));
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }));
  on('fs.exists', ($, e) => ({ value: onDisk(e.path) !== undefined }));
  on('fs.read', ($, e) => { const key = onDisk(e.path); return key ? { value: disk[key]! } : { deny: 'missing' }; });
  on('ui.log', () => ({ value: undefined }));
  on('ui.open', ($, e) => { opened.push(e); return { value: { isPlaced: true } }; });
  on('ui.close', ($, e) => { closed.push(e); return { value: undefined }; });
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }));
}

describe('session panel', () => {
  test('groups links by category, filters them and closes', async ($, on) => {
    const opened: unknown[] = [];
    const closed: unknown[] = [];
    beneath(on, opened, closed);
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
    const control = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'AbovePrompt', props: band });
    expect((await control.find({ key: 'ctx-monitor-links-open' }))?.text).toBe('Links · 2');
    expect((await control.find({ key: 'ctx-monitor-files-open' }))?.text).toBe('Files · 2 changed');
    await control.press({ key: 'ctx-monitor-links-open' });
    expect(opened[0]).toMatchObject({ id: 'ctx-monitor-session', closeOnEscape: true });
    const panel = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'Pane', requestId: 'ctx-monitor-session', props: pane });
    expect(await panel.findAll({ type: 'Link' })).toHaveLength(2);
    expect((await panel.find({ key: 'ctx-monitor-links-pr' }))?.text).toBe('Pull requests 1');
    await panel.press({ key: 'ctx-monitor-links-pr' });
    expect(await panel.findAll({ type: 'Link' })).toHaveLength(1);
    await panel.press({ key: 'ctx-monitor-links-all' });
    await panel.input({ key: 'ctx-monitor-links-search', text: 'docs', kind: 'change' });
    expect(await panel.findAll({ type: 'Link' })).toHaveLength(1);
    await panel.press({ key: 'ctx-monitor-close' });
    expect(closed).toHaveLength(1);
  });

  test('lists files by action and shows the session diff of one', async ($, on) => {
    beneath(on);
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
    const control = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'AbovePrompt', props: band });
    await control.press({ key: 'ctx-monitor-files-open' });
    const panel = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'Pane', requestId: 'ctx-monitor-session', props: pane });
    expect((await panel.find({ key: 'ctx-monitor-files-created' }))?.text).toBe('Created 1');
    expect((await panel.find({ key: 'ctx-monitor-files-edited' }))?.text).toBe('Edited 1');
    expect((await panel.find({ key: 'ctx-monitor-files-read' }))?.text).toBe('Read only 1');
    await panel.press({ key: 'file-/work/src/app.ts' });
    const [code] = await panel.findAll({ type: 'Code' });
    expect(code?.props.source).toBe('@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3');
    await panel.press({ key: 'ctx-monitor-file-back' });
    expect(await panel.findAll({ type: 'Code' })).toHaveLength(0);
  });

  test('yields to surveys and prints lists on request', async ($, on) => {
    beneath(on);
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
    const control = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'AbovePrompt', props: { ...band, hasSurvey: true } });
    expect(await control.findAll({ type: 'Button' })).toHaveLength(0);
    const presentation = { isFullscreen: false, columns: 120 };
    const links = await $.command.run({ command: 'ctx-links', args: 'list', origin: { kind: 'composer' }, presentation });
    expect(links.text).toContain('**Pull requests** (1)');
    expect(links.text).toContain('Fix cache');
    const files = await $.command.run({ command: 'ctx-files', args: 'list', origin: { kind: 'composer' }, presentation });
    expect(files.text).toContain('- `src/app.ts` (+1 −1)');
    expect(files.text).toContain('- `src/new.ts` (+1 −0)');
    expect(files.text).toContain('- `README.md` (read 1×)');
  });
});
