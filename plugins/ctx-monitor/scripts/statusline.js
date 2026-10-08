#!/usr/bin/env node
// Linhas de contexto, cache, ai-memory e limites de uso.
//
// Desligar segmentos: CTX_MONITOR_CACHE=0, CTX_MONITOR_AIMEMORY=0, CTX_MONITOR_RATE_LIMITS=0

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { C, paint, clean, k, color, separator, fit, context, hyperlink } = require('./format');

function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function contextSeg(d, columns) {
  const cw = d.context_window ?? {};
  const model = clean(d.model?.display_name ?? d.model?.id ?? 'modelo --').replace(/\s*\[[^\]]*context\]/i, '');
  const effort = d.effort?.level ? ` · ${clean(d.effort.level)}` : '';
  return paint(C.cyan, model) + effort + separator
    + context(cw.used_percentage, cw.total_input_tokens, cw.context_window_size, columns < 65 ? 0 : 10);
}

function cacheSeg(d) {
  const pc = d.prompt_cache;
  if (!pc || pc.caching_observed === false) return null;
  const leftSec = pc.expires_at ? pc.expires_at - Date.now() / 1000 : 0;
  const warm = pc.warm && leftSec > 0;
  const state = warm ? clock(leftSec) : 'frio';
  const parts = [`cache ${paint(warm ? C.green : C.yellow, state)}`];
  if (!warm && pc.recache_tokens_if_cold) parts.push(`reescrever ${k(pc.recache_tokens_if_cold)}`);
  if (pc.hit_ratio != null) parts.push(`hit ${Math.round(pc.hit_ratio * 100)}%`);
  if (pc.misses) parts.push(`misses ${pc.misses}`);
  return parts.join(' · ');
}

// `ai-memory status --json` faz chamada HTTP; resultado em cache por 30s.
function aiMemorySeg(d) {
  const session = String(d.session_id ?? 'x').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cacheFile = path.join(os.tmpdir(), `ctx-monitor-aimem-${session}.json`);
  let st;
  try {
    if (Date.now() - fs.statSync(cacheFile).mtimeMs < 30_000) st = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}
  if (!st) {
    st = { ok: false };
    try {
      const out = execFileSync('ai-memory', ['status', '--json'], {
        encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'],
      });
      st = { ok: true, ...JSON.parse(out) };
    } catch (e) {
      if (e.code === 'ENOENT') st = { missing: true };
      else {
        const m = String(e.stderr ?? '').match(/pending[":\s]+(\d+)/);
        st = { ok: false, pending: m ? Number(m[1]) : null };
      }
    }
    try { fs.writeFileSync(cacheFile, JSON.stringify(st)); } catch {}
  }
  if (st.missing) return null;
  const queue = st.ok ? st.spool?.pending : st.pending;
  const q = queue ? ` · fila ${queue}` : '';
  let webUrl = process.env.CTX_MONITOR_AIMEMORY_URL;
  if (!webUrl && st.client?.server_url) {
    try {
      const url = new URL(st.client.server_url);
      url.pathname = url.pathname.replace(/\/$/, '') + '/web';
      url.search = '';
      url.hash = '';
      webUrl = url.href;
    } catch {}
  }
  const label = hyperlink('ai-memory', webUrl);
  if (!st.ok) return label + ' ' + paint(C.yellow, 'offline') + q;
  return `${label} ${k(st.counts?.pages_latest ?? 0)} páginas` + q;
}

function rateLimitsSeg(d) {
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
        : `${pad(reset.getDate())}/${pad(reset.getMonth() + 1)} `;
      segment += ` · reset ${date}${pad(reset.getHours())}:${pad(reset.getMinutes())}`;
    }
    parts.push(segment);
  }
  return parts.length ? 'limites ' + parts.join(separator) : null;
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { return; }
  if (!d || typeof d !== 'object') return;

  const columns = Math.max(1, Number(process.env.COLUMNS) || 120);
  console.log(fit(contextSeg(d, columns), columns));
  const lines = [];
  if (process.env.CTX_MONITOR_CACHE !== '0') lines.push(cacheSeg(d));
  if (process.env.CTX_MONITOR_AIMEMORY !== '0') {
    try { lines.push(aiMemorySeg(d)); } catch {}
  }
  if (process.env.CTX_MONITOR_RATE_LIMITS !== '0') lines.push(rateLimitsSeg(d));
  for (const line of lines.filter(Boolean)) console.log(fit(line, columns));
});
