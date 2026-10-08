import type { On, RenderPropsOf, SessionMessage } from 'claude-code';
import { describe, expect, test } from 'claude-code/testing';

const messages: SessionMessage[] = [
  { role: 'assistant', text: '[Docs](https://example.com/docs)', toolUses: [
    { tool_use_id: 't1', tool: 'Bash', input: {}, result: { stdout: '{"title":"Fix cache","url":"https://github.com/acme/app/pull/12"}' } },
  ] },
];
const pane: RenderPropsOf['Pane'] = { isFocused: true, title: 'Links', bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} };
const band: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} };

function beneath(on: On, opened: unknown[] = [], closed: unknown[] = []) {
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('session.messages', () => ({ value: messages }));
  on('ui.open', ($, e) => { opened.push(e); return { value: { isPlaced: true } }; });
  on('ui.close', ($, e) => { closed.push(e); return { value: undefined }; });
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }));
}

describe('links', () => {
  test('renders one button, opens a pane, filters links and closes it', async ($, on) => {
    const opened: unknown[] = [];
    const closed: unknown[] = [];
    beneath(on, opened, closed);
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
    const control = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'AbovePrompt', props: band });
    expect((await control.find({ key: 'ctx-monitor-links-open' }))?.text).toBe('Links · 2');
    await control.press({ key: 'ctx-monitor-links-open' });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ id: 'ctx-monitor-links', closeOnEscape: true });
    const panel = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'Pane', requestId: 'ctx-monitor-links', props: pane });
    expect(await panel.findAll({ type: 'Link' })).toHaveLength(2);
    await panel.input({ key: 'ctx-monitor-links-search', text: 'cache', kind: 'change' });
    expect(await panel.findAll({ type: 'Link' })).toHaveLength(1);
    await panel.press({ key: 'ctx-monitor-links-close' });
    expect(closed).toHaveLength(1);
  });

  test('yields to surveys and prints a list on request', async ($, on) => {
    beneath(on);
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
    const control = await $.ui.mount({ plugin: 'ctx-monitor', surface: 'terminal', component: 'AbovePrompt', props: { ...band, hasSurvey: true } });
    expect(await control.findAll({ type: 'Button' })).toHaveLength(0);
    const output = await $.command.run({ command: 'ctx-links', args: 'list', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } });
    expect(output.text).toContain('https://github.com/acme/app/pull/12');
    expect(output.text).toContain('Fix cache');
  });
});
