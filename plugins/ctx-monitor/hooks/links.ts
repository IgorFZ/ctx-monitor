import type { On, EngineInterface, RenderElement, RenderInput, SessionMessage } from 'claude-code';
import { collectMessages, createCollection, markdownLinks, normalizeUrl } from '../scripts/links-core.mjs';

const PANE = 'ctx-monitor-links';

type State = { links: ReturnType<typeof collectMessages>; query: string; loading?: Promise<void> };

async function refresh($: EngineInterface, state: State) {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const messages: SessionMessage[] = await $.session.messages();
    const current = collectMessages(messages);
    const known = new Set(current.map(link => link.url));
    state.links = [...current, ...state.links.filter(link => !known.has(link.url))].slice(0, 300);
  })();
  try { await state.loading; } finally { state.loading = undefined; }
}

async function open($: EngineInterface, state: State) {
  try {
    await refresh($, state);
    state.query = '';
    const opened = await $.ui.open({ id: PANE, title: 'Session links', focus: true, closeOnEscape: true, holdToasts: true, rows: 16, columns: 72 });
    if (opened?.isPlaced === false) {
      await $.ui.close({ id: PANE });
      $.ui.log('The terminal could not fit the panel. Use /ctx-monitor:links.');
      return;
    }
    $.ui.invalidate('ui.render');
  } catch {
    $.ui.log('Could not open Links. Use /ctx-monitor:links to see the list in the conversation.');
  }
}

const state: State = { links: [], query: '' };

/** session.start part of the links; the hook in index.ts combines each feature's parts. */
export async function startLinks($: EngineInterface) {
  state.links = [];
  state.query = '';
  try {
    await $.command.register({ name: 'ctx-links', description: "Opens this session's links", argumentHint: '[list]', immediate: true });
    await refresh($, state);
  } catch {
    $.ui.log('Experimental links unavailable. Use /ctx-monitor:links.', { to: 'debug' });
  }
}

/** turn.complete part of the links, after the turn has ended. */
export async function completeTurnLinks($: EngineInterface) {
  try { await refresh($, state); $.ui.invalidate('ui.render'); } catch {}
}

/** Adds the links button to the band above the prompt. */
export function bandLinks($: EngineInterface, e: RenderInput<'AbovePrompt'>, beneath: RenderElement): RenderElement {
  if (e.surface !== 'terminal' || e.props.hasSurvey || !state.links.length) return beneath;
  const { Box, Button } = $.ui.resolve(e);
  return Box({ flexDirection: 'column', children: [beneath,
    Button({ key: 'ctx-monitor-links-open', label: `Links · ${state.links.length}`, plain: true,
      onPress: () => { void open($, state); } })] });
}

export function registerLinks(on: On) {
  on('tool.call', async ($, e, next) => {
    const result = await next(e);
    // The result may not be in the transcript yet when next returns.
    try {
      const collection = createCollection(state.links);
      collection.scan(result.result, e.tool);
      collection.scan(result.text, e.tool);
      state.links = collection.list();
      $.ui.invalidate('ui.render');
    } catch {}
    return result;
  });

  on('command.run', { command: 'ctx-links' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await refresh($, state);
      return { text: markdownLinks(state.links) };
    }
    await open($, state);
    return { text: '' };
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    const { Box, Text, Link, Input, Button } = $.ui.resolve(e);
    const filtered = state.links.filter(link => `${link.title} ${link.url} ${link.source}`.toLowerCase().includes(state.query.toLowerCase()));
    const rows = filtered.map(link => {
      // Link accepts https and localhost. Other http targets stay visible.
      const url = normalizeUrl(link.url);
      const clickable = url && (url.startsWith('https:') || new URL(url).hostname === 'localhost');
      return Box({ flexDirection: 'column', marginBottom: 1, children: [
        clickable ? Link({ href: url, label: link.title }) : Text({ children: link.title }),
        Text({ dimColor: true, wrap: 'truncate', children: `${link.source} · ${link.url}` })] });
    });
    const search = (value: string) => { state.query = value; $.ui.invalidate('ui.render'); };
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, children: `Session links · ${filtered.length}/${state.links.length}` }),
      Input({ key: 'ctx-monitor-links-search', placeholder: 'Search links', value: state.query, autoFocus: true,
        onInput: search, onSubmit: search }),
      Button({ key: 'ctx-monitor-links-refresh', label: 'Refresh', plain: true,
        onPress: () => { void refresh($, state).then(() => $.ui.invalidate('ui.render')).catch(() => {}); } }),
      ...rows,
      ...(!rows.length ? [Text({ dimColor: true, children: 'No links found.' })] : []),
      Button({ key: 'ctx-monitor-links-close', label: 'Close · Esc', plain: true,
        onPress: () => { void $.ui.close({ id: PANE }); } })] });
  });
}
