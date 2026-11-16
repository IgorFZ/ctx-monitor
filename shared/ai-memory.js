const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { C, paint, k, hyperlink } = require('./format');

function resolveWebUrl(st) {
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
  return webUrl;
}

// `ai-memory status --json` makes an HTTP call; the result is cached for 30s.
function getAiMemoryStatus(sessionId = 'x', ttlMs = 30_000) {
  const session = String(sessionId ?? 'x').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cacheFile = path.join(os.tmpdir(), `ctx-monitor-aimem-${session}.json`);
  let st;
  try {
    if (Date.now() - fs.statSync(cacheFile).mtimeMs < ttlMs) {
      st = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch {}
  if (!st) {
    st = { ok: false };
    try {
      const out = execFileSync('ai-memory', ['status', '--json'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'pipe'],
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
  return st;
}

function formatAiMemorySegment(sessionId) {
  const st = getAiMemoryStatus(sessionId);
  if (st.missing) return null;
  const queue = st.ok ? st.spool?.pending : st.pending;
  const q = queue ? ` · queue ${queue}` : '';
  const label = hyperlink('ai-memory', resolveWebUrl(st));
  if (!st.ok) return label + ' ' + paint(C.yellow, 'offline') + q;
  return `${label} ${k(st.counts?.pages_latest ?? 0)} pages` + q;
}

module.exports = { getAiMemoryStatus, formatAiMemorySegment, resolveWebUrl };
