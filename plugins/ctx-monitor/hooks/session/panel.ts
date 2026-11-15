import type { EngineInterface, On, RenderElement, RenderInput, SessionMessage } from 'claude-code';

import { collectMessages, createCollection, displayTitle, groupLinks, markdownLinks, normalizeUrl } from '../../scripts/links-core.mjs';
import type { Category, LinkEntry } from '../../scripts/links-core.mjs';
import { createFileLog, diffStat, hunksDiff, parseGitStatus, unifiedDiff } from './files';
import type { FileAction, FileEntry } from './files';

const PANE = 'ctx-monitor-session';
type Tab = 'links' | 'files';
type Change = { diff: string; added: number; removed: number; note?: string };

const FILE_GROUPS: [FileAction, string][] = [
  ['created', 'Created'],
  ['edited', 'Edited'],
  ['deleted', 'Deleted'],
  ['commands', 'Changed by commands'],
  ['read', 'Read only'],
];

const state = {
  tab: 'links' as Tab,
  links: [] as LinkEntry[],
  files: [] as FileEntry[],
  log: createFileLog(),
  changes: new Map<string, Change>(),
  cwd: '',
  gitRoot: '',
  // Files already dirty when the session started, with their mtime: changed again later, they count.
  gitBefore: new Map<string, number>(),
  linkFilter: 'all' as Category | 'all',
  fileFilter: 'all' as FileAction | 'all',
  query: '',
  selected: undefined as string | undefined,
  loading: undefined as Promise<void> | undefined,
};

const slash = (p: string) => p.replace(/\\/g, '/');

function relative(path: string) {
  const p = slash(path);
  const base = slash(state.cwd).replace(/\/$/, '');
  return base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

async function git($: EngineInterface, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['git', '-C', state.cwd, ...args], { timeoutMs: 5000 });
    return r.exitCode === 0 ? r.stdout : '';
  } catch {
    return '';
  }
}

async function mtime($: EngineInterface, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).mtimeMs;
  } catch {
    return -1;
  }
}

async function dirtyFiles($: EngineInterface): Promise<string[]> {
  if (!state.gitRoot) return [];
  return parseGitStatus(await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).map(p => `${state.gitRoot}/${p}`);
}

/** The session diff of one file: original content against the file as it is now. */
async function changeOf($: EngineInterface, file: FileEntry): Promise<Change> {
  let current: string | null = null;
  try {
    current = await $.fs.read(file.path);
  } catch {
    current = null;
  }
  if (file.action === 'commands') {
    const tracked = await git($, ['diff', '--no-color', '--no-ext-diff', '-U3', 'HEAD', '--', file.path]);
    const hunks = tracked.split('\n').filter(l => /^[@ +-]/.test(l) && !/^(\+\+\+|---) /.test(l)).join('\n');
    const diff = hunks || (current !== null ? unifiedDiff('', current) ?? '' : '');
    return { diff, ...diffStat(diff), note: 'Changed outside Claude\'s file tools; diff against HEAD.' };
  }
  if (file.original !== undefined) {
    const diff = unifiedDiff(file.original ?? '', current ?? '');
    if (diff !== undefined) return { diff, ...diffStat(diff), note: current === null ? 'The file no longer exists.' : undefined };
  }
  const diff = hunksDiff(file.hunks);
  return { diff, ...diffStat(diff), note: 'Original content unknown: each write\'s own changes, in order.' };
}

async function refresh($: EngineInterface) {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const messages: SessionMessage[] = await $.session.messages();
    const current = collectMessages(messages);
    const known = new Set(current.map(link => link.url));
    state.links = [...current, ...state.links.filter(link => !known.has(link.url))].slice(0, 300);

    const log = createFileLog();
    for (const message of messages) for (const use of message.toolUses ?? []) log.consume(use);
    state.log = log;
    const files = log.list();
    for (const f of files) {
      if ((f.action === 'created' || f.action === 'edited') && !(await $.fs.exists(f.path))) f.action = 'deleted';
    }
    const touched = new Set(files.map(f => slash(f.path)));
    for (const path of await dirtyFiles($)) {
      if (touched.has(slash(path))) continue;
      const before = state.gitBefore.get(path);
      if (before !== undefined && before === (await mtime($, path))) continue;
      files.push({ path, action: 'commands', reads: 0, writes: 0, hunks: [] });
    }
    state.files = files;
    state.changes = new Map();
    for (const f of files) if (f.action !== 'read') state.changes.set(f.path, await changeOf($, f));
  })();
  try { await state.loading; } finally { state.loading = undefined; }
}

async function open($: EngineInterface, tab: Tab) {
  try {
    state.tab = tab;
    state.query = '';
    state.selected = undefined;
    await refresh($);
    const opened = await $.ui.open({ id: PANE, title: 'Session', focus: true, closeOnEscape: true, holdToasts: true, rows: 24, columns: 88 });
    if (opened?.isPlaced === false) {
      await $.ui.close({ id: PANE });
      $.ui.log('The terminal could not fit the panel. Use /ctx-links list or /ctx-files list.');
      return;
    }
    $.ui.invalidate('ui.render');
  } catch {
    $.ui.log('Could not open the session panel. Use /ctx-monitor:links to see the links in the conversation.');
  }
}

function filesText(): string {
  if (!state.files.length) return 'No files read or changed in this session.';
  return FILE_GROUPS.flatMap(([action, label]) => {
    const group = state.files.filter(f => f.action === action);
    if (!group.length) return [];
    return [`**${label}** (${group.length})`, ...group.map(f => {
      const c = state.changes.get(f.path);
      const stat = c ? ` (+${c.added} −${c.removed})` : f.reads ? ` (read ${f.reads}×)` : '';
      return `- \`${relative(f.path)}\`${stat}`;
    }), ''];
  }).join('\n').trim();
}

/** session.start part of the session panel; the hook in index.ts combines each feature's parts. */
export async function startSession($: EngineInterface) {
  state.links = [];
  state.files = [];
  state.query = '';
  state.selected = undefined;
  try {
    await $.command.register({ name: 'ctx-links', description: "Opens this session's links", argumentHint: '[list]', immediate: true });
    await $.command.register({ name: 'ctx-files', description: 'Opens the files this session read, created, edited or deleted', argumentHint: '[list]', immediate: true });
    state.cwd = await $.session.cwd();
    state.gitRoot = slash((await git($, ['rev-parse', '--show-toplevel'])).trim());
    state.gitBefore = new Map();
    for (const path of await dirtyFiles($)) state.gitBefore.set(path, await mtime($, path));
    await refresh($);
  } catch {
    $.ui.log('Experimental session panel unavailable. Use /ctx-monitor:links.', { to: 'debug' });
  }
}

/** turn.complete part of the session panel, after the turn has ended. */
export async function completeTurnSession($: EngineInterface) {
  try { await refresh($); $.ui.invalidate('ui.render'); } catch {}
}

/** Adds the Links and Files buttons to the band above the prompt. */
export function bandSession($: EngineInterface, e: RenderInput<'AbovePrompt'>, beneath: RenderElement): RenderElement {
  const changed = state.files.filter(f => f.action !== 'read').length;
  if (e.surface !== 'terminal' || e.props.hasSurvey || (!state.links.length && !state.files.length)) return beneath;
  const { Box, Button } = $.ui.resolve(e);
  return Box({ flexDirection: 'column', children: [beneath, Box({ flexDirection: 'row', gap: 2, children: [
    ...(state.links.length ? [Button({ key: 'ctx-monitor-links-open', label: `Links · ${state.links.length}`, plain: true,
      onPress: () => { void open($, 'links'); } })] : []),
    ...(state.files.length ? [Button({ key: 'ctx-monitor-files-open', label: `Files · ${changed} changed`, plain: true,
      onPress: () => { void open($, 'files'); } })] : []),
  ] })] });
}

export function registerSession(on: On) {
  on('tool.call', async ($, e, next) => {
    const result = await next(e);
    // The result may not be in the transcript yet when next returns.
    try {
      const collection = createCollection(state.links);
      collection.scan(result.result, e.tool);
      collection.scan(result.text, e.tool);
      state.links = collection.list();
      const { tool, tool_use_id: _id, ...input } = e;
      state.log.consume({ tool, input: input as Record<string, unknown>, result: result.result, isError: result.isError });
      state.files = [...state.log.list(), ...state.files.filter(f => f.action === 'commands')];
      $.ui.invalidate('ui.render');
    } catch {}
    return result;
  });

  on('command.run', { command: 'ctx-links' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await refresh($);
      return { text: markdownLinks(state.links) };
    }
    await open($, 'links');
    return { text: '' };
  });

  on('command.run', { command: 'ctx-files' }, async ($, e) => {
    if (e.args.trim() === 'list') {
      await refresh($);
      return { text: filesText() };
    }
    await open($, 'files');
    return { text: '' };
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    const { Box, Text, Link, Input, Button, Code } = $.ui.resolve(e);
    const redraw = () => $.ui.invalidate('ui.render');
    const q = state.query.toLowerCase();
    const changed = state.files.filter(f => f.action !== 'read').length;

    const tabs = Box({ flexDirection: 'row', gap: 2, children: [
      Button({ key: 'ctx-monitor-tab-links', label: `Links ${state.links.length}`, variant: state.tab === 'links' ? 'primary' : 'secondary',
        onPress: () => { state.tab = 'links'; state.query = ''; state.selected = undefined; redraw(); } }),
      Button({ key: 'ctx-monitor-tab-files', label: `Files ${changed}/${state.files.length}`, variant: state.tab === 'files' ? 'primary' : 'secondary',
        onPress: () => { state.tab = 'files'; state.query = ''; state.selected = undefined; redraw(); } }),
      Button({ key: 'ctx-monitor-refresh', label: 'Refresh', plain: true,
        onPress: () => { void refresh($).then(redraw).catch(() => {}); } }),
      Button({ key: 'ctx-monitor-close', label: 'Close · Esc', plain: true, onPress: () => { void $.ui.close({ id: PANE }); } }),
    ] });
    const search = (placeholder: string) => Input({ key: `ctx-monitor-${state.tab}-search`, placeholder, value: state.query, autoFocus: true,
      onInput: (value: string) => { state.query = value; redraw(); }, onSubmit: (value: string) => { state.query = value; redraw(); } });
    const chip = (key: string, label: string, active: boolean, onPress: () => void) =>
      Button({ key, label, plain: true, dimColor: !active, onPress });

    if (state.tab === 'files' && state.selected) {
      const file = state.files.find(f => f.path === state.selected);
      const change = file && state.changes.get(file.path);
      return Box({ flexDirection: 'column', children: [
        tabs,
        Button({ key: 'ctx-monitor-file-back', label: '← Back', plain: true, autoFocus: true, onPress: () => { state.selected = undefined; redraw(); } }),
        Text({ bold: true, wrap: 'truncate-start', children: relative(state.selected) }),
        ...(!file ? [Text({ dimColor: true, children: 'This file is no longer in the list.' })]
          : !change ? [Text({ dimColor: true, children: `Read ${file.reads}× in this session; not changed.` })]
          : [
            Text({ children: [Text({ color: 'green', children: `+${change.added} ` }), Text({ color: 'red', children: `−${change.removed}` }),
              Text({ dimColor: true, children: change.note ? `  ${change.note}` : '' })] }),
            change.diff ? Code({ source: change.diff, format: 'diff', path: file.path }) : Text({ dimColor: true, children: 'No differences.' }),
          ]),
      ] });
    }

    if (state.tab === 'files') {
      const matches = state.files.filter(f => relative(f.path).toLowerCase().includes(q));
      const shown = matches.filter(f => state.fileFilter === 'all' || f.action === state.fileFilter);
      const chips = [
        chip('ctx-monitor-files-all', `All ${matches.length}`, state.fileFilter === 'all', () => { state.fileFilter = 'all'; redraw(); }),
        ...FILE_GROUPS.flatMap(([action, label]) => {
          const count = matches.filter(f => f.action === action).length;
          return count ? [chip(`ctx-monitor-files-${action}`, `${label} ${count}`, state.fileFilter === action, () => { state.fileFilter = action; redraw(); })] : [];
        }),
      ];
      const sections = FILE_GROUPS.flatMap(([action, label]) => {
        const group = shown.filter(f => f.action === action);
        if (!group.length) return [];
        return [Text({ bold: true, children: `${label} (${group.length})` }), ...group.map(f => {
          const c = state.changes.get(f.path);
          return Box({ flexDirection: 'row', key: `file-row-${f.path}`, children: [
            Button({ key: `file-${f.path}`, label: relative(f.path), plain: true, onPress: () => { state.selected = f.path; redraw(); } }),
            Text({ children: c ? [Text({ color: 'green', children: `  +${c.added}` }), Text({ color: 'red', children: ` −${c.removed}` })]
              : Text({ dimColor: true, children: `  read ${f.reads}×` }) }),
          ] });
        }), Text({ children: ' ' })];
      });
      return Box({ flexDirection: 'column', children: [
        tabs, Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: chips }), search('Search files'),
        ...(sections.length ? sections : [Text({ dimColor: true, children: 'No files found.' })]),
      ] });
    }

    const matches = state.links.filter(link => `${link.title} ${link.url} ${link.source}`.toLowerCase().includes(q));
    const groups = groupLinks(matches);
    const chips = [
      chip('ctx-monitor-links-all', `All ${matches.length}`, state.linkFilter === 'all', () => { state.linkFilter = 'all'; redraw(); }),
      ...groups.map(g => chip(`ctx-monitor-links-${g.id}`, `${g.label} ${g.links.length}`, state.linkFilter === g.id, () => { state.linkFilter = g.id; redraw(); })),
    ];
    const sections = groups.filter(g => state.linkFilter === 'all' || g.id === state.linkFilter).flatMap(group => [
      Text({ bold: true, children: `${group.label} (${group.links.length})` }),
      ...group.links.map(link => {
        // Link accepts https and localhost. Other http targets stay visible.
        const url = normalizeUrl(link.url);
        const clickable = url && (url.startsWith('https:') || new URL(url).hostname === 'localhost');
        const title = displayTitle(link, link.ref);
        const detail = [link.ref && link.ref !== title ? link.ref : new URL(link.url).hostname, link.source].join(' · ');
        return Box({ flexDirection: 'row', key: `link-row-${link.url}`, children: [
          clickable ? Link({ href: url, label: title }) : Text({ children: title }),
          Text({ dimColor: true, wrap: 'truncate', children: `  ${detail}` }),
        ] });
      }),
      Text({ children: ' ' }),
    ]);
    return Box({ flexDirection: 'column', children: [
      tabs, Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: chips }), search('Search links'),
      ...(sections.length ? sections : [Text({ dimColor: true, children: 'No links found.' })]),
    ] });
  });
}

