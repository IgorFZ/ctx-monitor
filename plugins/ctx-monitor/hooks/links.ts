import type { On, EngineInterface, SessionMessage } from 'claude-code';
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
    const opened = await $.ui.open({ id: PANE, title: 'Links da sessão', focus: true, closeOnEscape: true, holdToasts: true, rows: 16, columns: 72 });
    if (opened?.isPlaced === false) {
      await $.ui.close({ id: PANE });
      $.ui.log('O terminal não acomodou o painel. Use /ctx-monitor:links.');
      return;
    }
    $.ui.invalidate('ui.render');
  } catch {
    $.ui.log('Não foi possível abrir Links. Use /ctx-monitor:links para ver a lista na conversa.');
  }
}

export function register(on: On) {
  const state: State = { links: [], query: '' };

  on('session.start', async ($, e, next) => {
    state.links = [];
    state.query = '';
    try {
      await $.command.register({ name: 'ctx-links', description: 'Abre os links desta sessão', argumentHint: '[list]', immediate: true });
      await refresh($, state);
    } catch {
      $.ui.log('Links experimental indisponível. Use /ctx-monitor:links.', { to: 'debug' });
    }
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const result = await next(e);
    // O resultado pode ainda não estar no transcript quando next retorna.
    try {
      const collection = createCollection(state.links);
      collection.scan(result.result, e.tool);
      collection.scan(result.text, e.tool);
      state.links = collection.list();
      $.ui.invalidate('ui.render');
    } catch {}
    return result;
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    try { await refresh($, state); $.ui.invalidate('ui.render'); } catch {}
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const beneath = await next(e);
    if (e.surface !== 'terminal' || e.props.hasSurvey || !state.links.length) return beneath;
    const { Box, Button } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [beneath,
      Button({ key: 'ctx-monitor-links-open', label: `Links · ${state.links.length}`, plain: true,
        onPress: () => { void open($, state); } })] });
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE || e.surface !== 'terminal') return next(e);
    const { Box, Text, Link, Input, Button } = $.ui.resolve(e);
    const filtered = state.links.filter(link => `${link.title} ${link.url} ${link.source}`.toLowerCase().includes(state.query.toLowerCase()));
    const rows = filtered.map(link => {
      // Link aceita https e localhost. Outros destinos http continuam visíveis.
      const url = normalizeUrl(link.url);
      const clickable = url && (url.startsWith('https:') || new URL(url).hostname === 'localhost');
      return Box({ flexDirection: 'column', marginBottom: 1, children: [
        clickable ? Link({ href: url, label: link.title }) : Text({ children: link.title }),
        Text({ dimColor: true, wrap: 'truncate', children: `${link.source} · ${link.url}` })] });
    });
    const search = (value: string) => { state.query = value; $.ui.invalidate('ui.render'); };
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, children: `Links da sessão · ${filtered.length}/${state.links.length}` }),
      Input({ key: 'ctx-monitor-links-search', placeholder: 'Buscar links', value: state.query, autoFocus: true,
        onInput: search, onSubmit: search }),
      Button({ key: 'ctx-monitor-links-refresh', label: 'Atualizar', plain: true,
        onPress: () => { void refresh($, state).then(() => $.ui.invalidate('ui.render')).catch(() => {}); } }),
      ...rows,
      ...(!rows.length ? [Text({ dimColor: true, children: 'Nenhum link encontrado.' })] : []),
      Button({ key: 'ctx-monitor-links-close', label: 'Fechar · Esc', plain: true,
        onPress: () => { void $.ui.close({ id: PANE }); } })] });
  });
}
