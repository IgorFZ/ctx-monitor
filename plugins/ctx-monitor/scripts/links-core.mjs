// Local URL extraction; no network calls and no heuristic ID resolution.
export const MAX_LINKS = 300;
const plain = (text) => String(text ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();

export function normalizeUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return null;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const normalized = url.href.replace(/@/g, '%40');
    return normalized.length <= 2048 ? normalized : null;
  } catch { return null; }
}

function trimUrl(value) {
  let url = value.replace(/[.,;:!?]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
  }
  return url;
}

export function createCollection(seed = []) {
  const entries = new Map(seed.map(link => [link.url, { ...link }]));
  let order = Math.max(0, ...seed.map(link => link.order ?? 0));
  function add(raw, title, source, priority = 0) {
    const url = normalizeUrl(raw);
    if (!url) return;
    const previous = entries.get(url);
    const label = plain(title).slice(0, 160);
    entries.delete(url);
    entries.set(url, {
      url, title: label && priority >= (previous?.priority ?? 0) ? label : previous?.title || new URL(url).hostname,
      source: plain(source).slice(0, 80) || 'conversation', priority: Math.max(priority, previous?.priority ?? 0), order: ++order,
    });
    if (entries.size > MAX_LINKS) entries.delete(entries.keys().next().value);
  }
  function scan(value, source = 'conversation', depth = 0) {
    if (depth > 12 || value == null) return;
    if (typeof value === 'string') {
      const text = value.slice(0, 1_000_000);
      // JSON returned by gh/MCP keeps the title next to the URL.
      if (/^\s*[\[{]/.test(text)) {
        try { scan(JSON.parse(text), source, depth + 1); } catch {}
      }
      for (const match of text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+?)\)(?=\s|[.,;!?]|$)/g)) {
        add(trimUrl(match[2]), match[1], source, 2);
      }
      for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\x00-\x1f\x7f]+/g)) add(trimUrl(match[0]), '', source);
    } else if (Array.isArray(value)) {
      for (const item of value) scan(item, source, depth + 1);
    } else if (typeof value === 'object') {
      for (const key of ['url', 'html_url', 'web_url']) {
        if (typeof value[key] === 'string') add(value[key], value.title ?? value.name, source, 3);
      }
      for (const [key, item] of Object.entries(value)) {
        if (!['url', 'html_url', 'web_url'].includes(key)) scan(item, source, depth + 1);
      }
    }
  }
  return { scan, list: () => [...entries.values()].sort((a, b) => b.order - a.order) };
}

export function createMessageCollector() {
  const collection = createCollection();
  const toolNames = new Map();
  function consume(message) {
    collection.scan(message.text, message.role === 'assistant' ? 'Claude' : 'you');
    for (const tool of message.toolUses ?? []) {
      toolNames.set(tool.id ?? tool.tool_use_id, tool.name ?? tool.tool ?? 'tool');
      collection.scan(tool.result, tool.name ?? tool.tool ?? 'tool');
      collection.scan(tool.text, tool.name ?? tool.tool ?? 'tool');
    }
    for (const result of message.toolResults ?? []) {
      const name = toolNames.get(result.tool_use_id) ?? 'tool';
      collection.scan(result.result, name);
      collection.scan(result.text, name);
    }
  }
  return { consume, list: collection.list };
}

export function collectMessages(messages) {
  const collection = createMessageCollector();
  for (const message of messages) collection.consume(message);
  return collection.list();
}

// Category order is the order sections are drawn in.
export const CATEGORIES = [
  ['pr', 'Pull requests'],
  ['issue', 'Issues'],
  ['branch', 'Branches'],
  ['commit', 'Commits'],
  ['ci', 'CI runs'],
  ['code', 'Repos & code'],
  ['search', 'Web search'],
  ['docs', 'Docs'],
  ['local', 'Local'],
  ['other', 'Other'],
];
const FORGE = /^(?:[\w-]+\.)*(?:github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com|visualstudio\.com)$/;
const SEARCH_TOOLS = new Set(['WebSearch', 'web_search']);
const DOCS_HOST = /^(?:docs?|developer|developers|learn|api|wiki|reference)\./;
const DOCS_SITES = /(?:^|\.)(?:readthedocs\.io|developer\.mozilla\.org|learn\.microsoft\.com|pkg\.go\.dev|docs\.rs|npmjs\.com|pypi\.org|stackoverflow\.com)$/;

/** Puts a link in one of CATEGORIES and, for PRs and issues, gives it a short reference like `owner/repo#12`. */
export function categorize(link) {
  let url;
  try { url = new URL(link.url); } catch { return { category: 'other', ref: '' }; }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (FORGE.test(host)) {
    const repo = parts.slice(0, 2).join('/');
    const at = (i) => parts[i] ?? '';
    // GitLab nests a "-" before the resource; Azure DevOps names it _git/<repo>/pullrequest/N.
    const rest = at(2) === '-' ? parts.slice(3) : parts.slice(2);
    const kind = rest[0] ?? '';
    const id = rest[1] ?? '';
    const azure = parts.indexOf('pullrequest');
    if (azure > 0) {
      const n = at(azure + 1);
      return { category: 'pr', ref: /^\d+$/.test(n) ? `${at(azure - 1)}#${n}` : '' };
    }
    if (/^(?:pull|pulls|merge_requests)$/.test(kind)) {
      if (id === 'new') return { category: 'branch', ref: rest.slice(2).join('/') };
      return { category: 'pr', ref: /^\d+$/.test(id) ? `${repo}#${id}` : '' };
    }
    if (/^(?:issues|work_items)$/.test(kind) || (host === 'dev.azure.com' && parts.includes('_workitems'))) {
      return { category: 'issue', ref: /^\d+$/.test(id) ? `${repo}#${id}` : '' };
    }
    if (/^(?:tree|compare|branches|branch)$/.test(kind)) return { category: 'branch', ref: rest.slice(1).join('/') };
    if (/^(?:commit|commits)$/.test(kind)) return { category: 'commit', ref: id.slice(0, 12) };
    if (/^(?:actions|pipelines|jobs|runs|checks)$/.test(kind)) {
      const run = rest.find(part => /^\d+$/.test(part));
      return { category: 'ci', ref: run ? `${repo} run ${run}` : repo };
    }
    if (/^(?:blob|raw)$/.test(kind)) return { category: 'code', ref: `${repo}: ${rest.slice(2).join('/')}` };
    if (parts.length >= 2) return { category: 'code', ref: repo.replace(/\.git$/, '') };
  }
  if (/(?:^|\.)atlassian\.net$/.test(host) && parts[0] === 'browse') return { category: 'issue', ref: parts[1] ?? '' };
  if (host === 'linear.app' && parts.includes('issue')) return { category: 'issue', ref: parts[parts.indexOf('issue') + 1] ?? '' };
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) return { category: 'local', ref: '' };
  if (SEARCH_TOOLS.has(link.source)) return { category: 'search', ref: '' };
  if (DOCS_HOST.test(host) || DOCS_SITES.test(host) || /\/(?:docs?|documentation|reference|api)(?:\/|$)/.test(url.pathname)) {
    return { category: 'docs', ref: '' };
  }
  return { category: 'other', ref: '' };
}

/** Links grouped by category, in CATEGORIES order, empty groups left out. */
export function groupLinks(links) {
  const groups = new Map(CATEGORIES.map(([id]) => [id, []]));
  for (const link of links) {
    const { category, ref } = categorize(link);
    groups.get(category).push({ ...link, category, ref });
  }
  return CATEGORIES.map(([id, label]) => ({ id, label, links: groups.get(id) })).filter(group => group.links.length);
}

/** What to call a link: its own title, else its short reference, else its host and path. */
export function displayTitle(link, ref = categorize(link).ref) {
  let url;
  try { url = new URL(link.url); } catch { return link.title || link.url; }
  if (link.title && link.title !== url.hostname) return link.title;
  if (ref) return ref;
  const path = url.pathname.replace(/\/$/, '');
  return path ? `${url.hostname}${path.length > 60 ? `${path.slice(0, 59)}…` : path}` : url.hostname;
}

export function markdownLinks(links) {
  if (!links.length) return 'No links found in this session.';
  const escape = (text) => plain(text).replace(/[\\\[\]*_`]/g, '\\$&');
  return groupLinks(links).map(group => [`**${group.label}** (${group.links.length})`,
    ...group.links.map(link => `- [${escape(displayTitle(link, link.ref))}](<${link.url}>) — ${escape(link.source)}`),
  ].join('\n')).join('\n\n');
}
