#!/usr/bin/env node
// Status line do agente principal (ctx-monitor) — tema ícones compactos
//
// Desligar segmentos: CTX_MONITOR_CACHE=0, CTX_MONITOR_AIMEMORY=0

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', magenta: '\x1b[35m',
            green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m' };

function k(n) {
  if (n == null) return '?';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;
}

function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Tema: ícones compactos — tudo numa linha.
//   ◆ modelo  ⚙ effort  ◐ contexto%  tokens  ⏲ TTL | ❄ fria  ↺ hit%  ✕ misses  ⛁ ai-memory  ⧗ fila
// Ícone do contexto/pizza muda com o uso: ○ ◔ ◑ ◕ ●

const pie = (p) => (p >= 88 ? '●' : p >= 63 ? '◕' : p >= 38 ? '◑' : p >= 13 ? '◔' : '○');
const col = (p) => (p >= 85 ? C.red : p >= 60 ? C.yellow : C.green);
const paint = (c, t) => `${c}${t}${C.reset}`;

function contextSeg(d) {
  const cw = d.context_window ?? {};
  const pct = Math.floor(cw.used_percentage ?? 0);
  const parts = [paint(C.cyan, `◆ ${d.model?.display_name ?? d.model?.id ?? '?'}`)];
  if (d.effort?.level) parts.push(paint(C.magenta, `⚙ ${d.effort.level}`));
  parts.push(paint(col(pct), `${pie(pct)} ${pct}%`));
  if (cw.total_input_tokens != null) parts.push(paint(C.dim, k(cw.total_input_tokens)));
  return parts.join(' ');
}

function cacheSeg(d) {
  const pc = d.prompt_cache;               // requer CC >= 2.1.251
  if (!pc || pc.caching_observed === false) return null;
  const parts = [];
  if (pc.warm && pc.expires_at) {
    const leftSec = pc.expires_at - Date.now() / 1000;
    const ttlSec = pc.ttl === '1h' ? 3600 : 300;
    parts.push(paint(leftSec < ttlSec * 0.2 ? C.yellow : C.green, `⏲ ${clock(leftSec)}`));
  } else {
    const re = pc.recache_tokens_if_cold;
    parts.push(paint(C.blue, `❄ fria`) + (re ? paint(C.dim, ` ↻${k(re)}`) : ''));
  }
  if (pc.hit_ratio != null) {
    const hr = Math.round(pc.hit_ratio * 100);
    parts.push(paint(hr >= 80 ? C.green : hr >= 50 ? C.yellow : C.red, `↺ ${hr}%`));
  }
  if (pc.misses) {
    const cause = pc.last_miss_cause?.causes?.[0];
    parts.push(paint(C.yellow, `✕${pc.misses}`) + (cause ? paint(C.dim, `:${cause}`) : ''));
  }
  return parts.join(' ');
}

// `ai-memory status --json` faz chamada HTTP; resultado em cache por 30s.
function aiMemorySeg(d) {
  const cacheFile = path.join(os.tmpdir(), `ctx-monitor-aimem-${d.session_id ?? 'x'}.json`);
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
  const q = queue ? ' ' + paint(C.yellow, `⧗${queue}`) : '';
  if (!st.ok) return paint(C.red, '⛁ off') + q;
  return paint(C.green, `⛁ ${k(st.counts?.pages_latest ?? 0)}`) + q;
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { console.log('statusline: JSON inválido'); return; }

  const segs = [contextSeg(d)];
  if (process.env.CTX_MONITOR_CACHE !== '0') segs.push(cacheSeg(d));
  if (process.env.CTX_MONITOR_AIMEMORY !== '0') {
    try { segs.push(aiMemorySeg(d)); } catch {}
  }
  console.log(segs.filter(Boolean).join('  '));
});
