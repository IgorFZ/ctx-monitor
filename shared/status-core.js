const { C, paint, clean, k, color, separator, clock, fit, context } = require('./format');
const { formatAiMemorySegment } = require('./ai-memory');

function renderContextSegment(d, columns) {
  const cw = d.context_window ?? {};
  const model = clean(d.model?.display_name ?? d.model?.id ?? 'model --').replace(/\s*\[[^\]]*context\]/i, '');
  const effort = d.effort?.level ? ` · ${clean(d.effort.level)}` : '';
  return paint(C.cyan, model) + effort + separator
    + context(cw.used_percentage, cw.total_input_tokens, cw.context_window_size, columns < 65 ? 0 : 10);
}

function renderCacheSegment(d) {
  const pc = d.prompt_cache;
  if (!pc || pc.caching_observed === false) return null;
  const leftSec = pc.expires_at ? pc.expires_at - Date.now() / 1000 : 0;
  const warm = pc.warm && leftSec > 0;
  const state = warm ? clock(leftSec) : 'cold';
  const parts = [`cache ${paint(warm ? C.green : C.yellow, state)}`];
  if (!warm && pc.recache_tokens_if_cold) parts.push(`rewrite ${k(pc.recache_tokens_if_cold)}`);
  if (pc.hit_ratio != null) parts.push(`hit ${Math.round(pc.hit_ratio * 100)}%`);
  if (pc.misses) parts.push(`misses ${pc.misses}`);
  return parts.join(' · ');
}

function renderRateLimitsSegment(d) {
  const now = Date.now();
  const parts = [];
  for (const [key, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const limit = d.rate_limits?.[key];
    if (!limit || !Number.isFinite(limit.used_percentage) || limit.used_percentage < 0) continue;
    const reset = Number.isFinite(limit.resets_at) ? new Date(limit.resets_at * 1000) : null;
    if (reset && (!Number.isFinite(reset.getTime()) || reset.getTime() <= now)) continue;
    let segment = `${label} ${paint(color(limit.used_percentage), `${Math.round(limit.used_percentage)}%`)}`;
    if (reset) {
      const pad = (n) => String(n).padStart(2, '0');
      const today = new Date(now);
      const date = reset.toDateString() === today.toDateString() ? ''
        : `${reset.toLocaleString('en-US', { month: 'short' })} ${reset.getDate()} `;
      segment += ` · reset ${date}${pad(reset.getHours())}:${pad(reset.getMinutes())}`;
    }
    parts.push(segment);
  }
  return parts.length ? 'limits ' + parts.join(separator) : null;
}

function renderStatusLines(d, columns = 120) {
  const cols = Math.max(1, Number(columns) || 120);
  const out = [fit(renderContextSegment(d, cols), cols)];
  const extra = [];
  if (process.env.CTX_MONITOR_CACHE !== '0') extra.push(renderCacheSegment(d));
  if (process.env.CTX_MONITOR_AIMEMORY !== '0') {
    try { extra.push(formatAiMemorySegment(d.session_id)); } catch {}
  }
  if (process.env.CTX_MONITOR_RATE_LIMITS !== '0') extra.push(renderRateLimitsSegment(d));
  for (const line of extra.filter(Boolean)) out.push(fit(line, cols));
  return out;
}

module.exports = { renderContextSegment, renderCacheSegment, renderRateLimitsSegment, renderStatusLines };
