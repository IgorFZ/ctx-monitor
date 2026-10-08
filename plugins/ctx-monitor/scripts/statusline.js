#!/usr/bin/env node
// Status line do agente principal (ctx-monitor)
//   linha 1: modelo · effort · barra de contexto
//   linha 2: prompt cache — quente/fria, hit ratio, tempo restante do TTL, misses
//   linha 3: ai-memory — servidor, páginas, eventos na fila (só se o CLI existir)
//
// Desligar segmentos: CTX_MONITOR_CACHE=0, CTX_MONITOR_AIMEMORY=0

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', magenta: '\x1b[35m',
            green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m' };
const SEP = `${C.dim} · ${C.reset}`;

function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p * width) / 100);
  const color = p >= 85 ? C.red : p >= 60 ? C.yellow : C.green;
  return `${color}${'█'.repeat(filled)}${C.dim}${'░'.repeat(width - filled)}${C.reset}`;
}

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

// ---------- linha 1: contexto ----------
function contextLine(d) {
  const model = d.model?.display_name ?? d.model?.id ?? '?';
  const effort = d.effort?.level;
  const cw = d.context_window ?? {};
  const pct = Math.floor(cw.used_percentage ?? 0);
  return [
    `${C.cyan}${model}${C.reset}`,
    effort ? `${C.magenta}effort:${effort}${C.reset}` : null,
    `${bar(pct)} ${pct}% ${C.dim}(${k(cw.total_input_tokens)}/${k(cw.context_window_size)})${C.reset}`,
  ].filter(Boolean).join(SEP);
}

// ---------- linha 2: prompt cache ----------
function cacheLine(d) {
  const pc = d.prompt_cache;               // ausente até a 1ª resposta; requer CC >= 2.1.251
  if (!pc) return null;
  if (pc.caching_observed === false) return `${C.dim}cache: não reportado pelo provedor${C.reset}`;

  const parts = [];
  const now = Date.now() / 1000;

  if (pc.warm && pc.expires_at) {
    const left = pc.expires_at - now;
    const ttlSec = pc.ttl === '1h' ? 3600 : 300;
    const color = left < ttlSec * 0.2 ? C.yellow : C.green;
    parts.push(`${color}● cache quente${C.reset} ${C.dim}(${pc.ttl ?? '?'})${C.reset} expira em ${color}${clock(left)}${C.reset}`);
  } else {
    const re = pc.recache_tokens_if_cold;
    parts.push(`${C.blue}❄ cache fria${C.reset}${re ? ` ${C.dim}— próxima req reescreve ${k(re)}${C.reset}` : ''}`);
  }

  if (pc.hit_ratio != null) {
    const hr = Math.round(pc.hit_ratio * 100);
    const color = hr >= 80 ? C.green : hr >= 50 ? C.yellow : C.red;
    parts.push(`hit ${color}${hr}%${C.reset}`);
  }

  if (pc.misses) {
    const cause = pc.last_miss_cause?.causes?.join('+');
    parts.push(`${C.yellow}${pc.misses} miss${pc.misses > 1 ? 'es' : ''}${C.reset}${cause ? ` ${C.dim}(último: ${cause})${C.reset}` : ''}`);
  }
  if (pc.expected_rebuilds) parts.push(`${C.dim}${pc.expected_rebuilds} rebuild(s) esperado(s)${C.reset}`);

  return parts.join(SEP);
}

// ---------- linha 3: ai-memory ----------
// `ai-memory status --json` faz uma chamada HTTP; o resultado fica em cache por 30s
// para não pesar no refresh da status line.
function aiMemoryLine(d) {
  const cacheFile = path.join(os.tmpdir(), `ctx-monitor-aimem-${d.session_id ?? 'x'}.json`);
  let st;
  try {
    const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (age < 30_000) st = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}

  if (!st) {
    st = { ok: false };
    try {
      const out = execFileSync('ai-memory', ['status', '--json'], {
        encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'pipe'],
      });
      st = { ok: true, ...JSON.parse(out) };
    } catch (e) {
      if (e.code === 'ENOENT') st = { missing: true };       // CLI não instalado
      else {
        // Servidor fora do ar: o CLI imprime o spool local no stderr
        const m = String(e.stderr ?? '').match(/pending[":\s]+(\d+)/);
        st = { ok: false, pending: m ? Number(m[1]) : null };
      }
    }
    try { fs.writeFileSync(cacheFile, JSON.stringify(st)); } catch {}
  }

  if (st.missing) return null;
  if (!st.ok) {
    const q = st.pending ? ` ${C.yellow}· ${st.pending} evento(s) na fila${C.reset}` : '';
    return `${C.red}✗ ai-memory offline${C.reset}${q}`;
  }
  const parts = [`${C.green}● ai-memory${C.reset}`];
  if (st.counts?.pages_latest != null) parts.push(`${k(st.counts.pages_latest)} páginas`);
  if (st.counts?.sessions != null) parts.push(`${k(st.counts.sessions)} sessões`);
  if (st.spool?.pending) parts.push(`${C.yellow}${st.spool.pending} na fila${C.reset}`);
  if (st.capture_mode === 'allowlist') parts.push(`${C.dim}captura: allowlist${C.reset}`);
  return parts.join(SEP);
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { console.log('statusline: JSON inválido'); return; }

  const lines = [contextLine(d)];
  if (process.env.CTX_MONITOR_CACHE !== '0') lines.push(cacheLine(d));
  if (process.env.CTX_MONITOR_AIMEMORY !== '0') {
    try { lines.push(aiMemoryLine(d)); } catch {}
  }
  console.log(lines.filter(Boolean).join('\n'));
});
