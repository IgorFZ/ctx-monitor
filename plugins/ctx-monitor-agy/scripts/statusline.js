#!/usr/bin/env node
// Antigravity CLI (`agy`) statusLine renderer.
const fs = require('fs');
const path = require('path');

function loadCore() {
  const local = path.join(__dirname, 'status-core.js');
  if (fs.existsSync(local)) return require(local);
  return require(path.resolve(__dirname, '../../../shared/status-core'));
}

const { renderStatusLines } = loadCore();

function normalizeAgyPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const modelObj = typeof raw.model === 'string'
    ? { display_name: raw.model }
    : raw.model ?? (raw.modelName || raw.model_name ? { display_name: raw.modelName ?? raw.model_name } : undefined);

  const effortLevel = raw.effort?.level ?? raw.effort_level ?? raw.thinking_level ?? (typeof raw.effort === 'string' ? raw.effort : undefined);
  const effort = effortLevel ? { level: effortLevel } : undefined;

  const cwSrc = raw.context_window ?? raw.contextWindow ?? raw.context ?? {};
  const tokens = cwSrc.total_input_tokens ?? cwSrc.totalInputTokens ?? cwSrc.used_tokens ?? cwSrc.tokens
    ?? raw.tokens?.input ?? raw.usage?.input_tokens ?? raw.input_tokens;
  const capacity = cwSrc.context_window_size ?? cwSrc.contextWindowSize ?? cwSrc.max_tokens ?? cwSrc.limit
    ?? raw.context_window_size ?? raw.max_tokens;
  let pct = cwSrc.used_percentage ?? cwSrc.usedPercentage ?? cwSrc.percent ?? raw.context_percent ?? raw.used_percent;
  if (pct == null && Number.isFinite(tokens) && Number.isFinite(capacity) && capacity > 0) {
    pct = (tokens / capacity) * 100;
  }

  return {
    session_id: raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? raw.conversationId ?? 'agy',
    model: modelObj,
    effort,
    context_window: {
      used_percentage: pct,
      total_input_tokens: tokens,
      context_window_size: capacity,
    },
    prompt_cache: raw.prompt_cache ?? raw.promptCache,
    rate_limits: raw.rate_limits ?? raw.rateLimits,
  };
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let raw;
    try { raw = JSON.parse(input); } catch { return; }
    const normalized = normalizeAgyPayload(raw);
    if (!normalized) return;
    const columns = Math.max(1, Number(process.env.COLUMNS) || 120);
    for (const line of renderStatusLines(normalized, columns)) {
      console.log(line);
    }
  });
}

module.exports = { normalizeAgyPayload };
