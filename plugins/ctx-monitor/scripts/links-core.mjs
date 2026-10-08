// Extração local de URLs; sem chamadas de rede e sem resolver IDs por heurística.
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
      source: plain(source).slice(0, 80) || 'conversa', priority: Math.max(priority, previous?.priority ?? 0), order: ++order,
    });
    if (entries.size > MAX_LINKS) entries.delete(entries.keys().next().value);
  }
  function scan(value, source = 'conversa', depth = 0) {
    if (depth > 12 || value == null) return;
    if (typeof value === 'string') {
      const text = value.slice(0, 1_000_000);
      // JSON retornado por gh/MCP mantém o título junto da URL.
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
    collection.scan(message.text, message.role === 'assistant' ? 'Claude' : 'você');
    for (const tool of message.toolUses ?? []) {
      toolNames.set(tool.id ?? tool.tool_use_id, tool.name ?? tool.tool ?? 'ferramenta');
      collection.scan(tool.result, tool.name ?? tool.tool ?? 'ferramenta');
      collection.scan(tool.text, tool.name ?? tool.tool ?? 'ferramenta');
    }
    for (const result of message.toolResults ?? []) {
      const name = toolNames.get(result.tool_use_id) ?? 'ferramenta';
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

export function markdownLinks(links) {
  if (!links.length) return 'Nenhum link encontrado nesta sessão.';
  const escape = (text) => plain(text).replace(/[\\\[\]*_`]/g, '\\$&');
  return links.map(link => `- [${escape(link.title)}](<${link.url}>) — ${escape(link.source)}`).join('\n');
}
