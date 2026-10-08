#!/usr/bin/env node
// Status line do agente principal: modelo · effort · barra de contexto
// Configurar em ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js" }

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', magenta: '\x1b[35m',
            green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };

function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p * width) / 100);
  const color = p >= 85 ? C.red : p >= 60 ? C.yellow : C.green;
  return `${color}${'█'.repeat(filled)}${C.dim}${'░'.repeat(width - filled)}${C.reset}`;
}

function k(n) {
  if (n == null) return '?';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { console.log('statusline: JSON inválido'); return; }

  const model = d.model?.display_name ?? d.model?.id ?? '?';
  const effort = d.effort?.level;                    // ausente se o modelo não suporta effort
  const cw = d.context_window ?? {};
  const pct = Math.floor(cw.used_percentage ?? 0);   // null antes da 1ª resposta e logo após /compact
  const used = cw.total_input_tokens;
  const size = cw.context_window_size;

  const parts = [
    `${C.cyan}${model}${C.reset}`,
    effort ? `${C.magenta}effort:${effort}${C.reset}` : null,
    `${bar(pct)} ${pct}% ${C.dim}(${k(used)}/${k(size)})${C.reset}`,
  ].filter(Boolean);

  console.log(parts.join(`${C.dim} · ${C.reset}`));
});
