const C = { reset: '\x1b[0m', cyan: '\x1b[36m', gray: '\x1b[90m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };
const paint = (color, text) => `${color}${text}${C.reset}`;
const osc8 = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const clean = (text) => String(text).replace(osc8, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ');
const k = (n) => n == null ? '?' : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M`
  : n >= 1000 ? `${+(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const color = (p) => p >= 85 ? C.red : p >= 60 ? C.yellow : C.green;
const separator = paint(C.gray, ' | ');

function width(text) {
  return Array.from(clean(text)).reduce((sum, char) => sum + (/\p{Mark}/u.test(char) ? 0
    : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1), 0);
}

// Limita o texto visível sem cortar sequências ANSI.
function fit(text, columns) {
  if (width(text) <= columns) return text;
  let result = '', used = 0, linked = false;
  for (const part of text.match(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^]/gu) ?? []) {
    if (part.startsWith('\x1b')) {
      if (part.startsWith('\x1b]8;')) linked = !/^\x1b\]8;;(?:\x07|\x1b\\)$/.test(part);
      result += part;
      continue;
    }
    const size = width(part);
    if (used + size > Math.max(0, columns - 1)) break;
    result += part;
    used += size;
  }
  return result + '…' + (linked ? '\x1b]8;;\x1b\\' : '') + C.reset;
}

function context(pct, tokens, capacity, barWidth = 10, approximate = false) {
  if (pct == null || !Number.isFinite(pct)) return 'ctx --';
  const p = Math.max(0, Math.floor(pct));
  const filled = Math.round(Math.min(100, p) / 100 * barWidth);
  const bar = barWidth ? paint(color(p), '━'.repeat(filled)) + paint(C.gray, '─'.repeat(barWidth - filled)) + ' ' : '';
  const counts = tokens == null ? '' : ` · ${k(tokens)}${capacity ? `/${k(capacity)}` : ''}`;
  return `ctx ${bar}${paint(color(p), `${approximate ? '~' : ''}${p}%`)}${counts}`;
}

function hyperlink(text, target) {
  if (!target || /[\x00-\x20\x7f]/.test(target)) return text;
  try {
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return text;
    return `\x1b]8;;${url.href}\x1b\\${text}\x1b]8;;\x1b\\`;
  } catch { return text; }
}

module.exports = { C, paint, clean, k, color, separator, width, fit, context, hyperlink };
