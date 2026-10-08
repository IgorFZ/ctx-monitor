#!/usr/bin/env node
// Linha de cada subagente no painel de agentes (ctx-monitor) — tema ícones compactos
//   ● nome  modelo  effort  ◔ contexto%  tokens
// Entrada: { columns, tasks: [...] }. Saída: uma linha JSON {"id","content"} por subagente.

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', magenta: '\x1b[35m',
            green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m' };
const paint = (c, t) => `${c}${t}${C.reset}`;
const pie = (p) => (p >= 88 ? '●' : p >= 63 ? '◕' : p >= 38 ? '◑' : p >= 13 ? '◔' : '○');
const col = (p) => (p >= 85 ? C.red : p >= 60 ? C.yellow : C.green);
const k = (n) => (n == null ? '?' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

// "claude-haiku-5-5" -> "haiku"
const shortModel = (id) => (id ? id.replace(/^claude-/, '').replace(/-\d.*$/, '') : '…');

const STATUS = { running: paint(C.blue, '●'), completed: paint(C.green, '✓'),
                 failed: paint(C.red, '✗'), killed: paint(C.red, '■') };

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { return; }

  for (const t of d.tasks ?? []) {
    const parts = [
      STATUS[t.status] ?? paint(C.dim, '·'),
      paint(C.cyan, t.name ?? t.agentType ?? 'agent'),
      paint(C.dim, shortModel(t.model)),
    ];
    if (t.effort != null) parts.push(paint(C.magenta, String(t.effort)));
    if (t.contextWindowSize && t.tokenCount != null) {
      const pct = Math.floor((t.tokenCount / t.contextWindowSize) * 100);
      parts.push(paint(col(pct), `${pie(pct)} ${pct}%`), paint(C.dim, k(t.tokenCount)));
    }
    process.stdout.write(JSON.stringify({ id: t.id, content: parts.join(' ') }) + '\n');
  }
});
