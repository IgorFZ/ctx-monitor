#!/usr/bin/env node
// Linha customizada para cada subagente no painel de agentes.
// Configurar em ~/.claude/settings.json:
//   "subagentStatusLine": { "type": "command", "command": "node ~/.claude/subagent-statusline.js" }
//
// Entrada: um JSON com { columns, tasks: [...] }.
// Saída: uma linha JSON por subagente, no formato {"id": "...", "content": "..."}.

const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', magenta: '\x1b[35m',
            green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m' };

function bar(pct, width = 12) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p * width) / 100);
  const color = p >= 85 ? C.red : p >= 60 ? C.yellow : C.green;
  return `${color}${'█'.repeat(filled)}${C.dim}${'░'.repeat(width - filled)}${C.reset}`;
}

function k(n) {
  if (n == null) return '?';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

// "claude-sonnet-5-5" -> "sonnet-5-5"
const shortModel = (id) => (id ? id.replace(/^claude-/, '') : 'resolvendo…');

const STATUS_ICON = { running: `${C.blue}●${C.reset}`, completed: `${C.green}✓${C.reset}`,
                      failed: `${C.red}✗${C.reset}`, killed: `${C.red}■${C.reset}` };

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let d;
  try { d = JSON.parse(input); } catch { return; } // sem saída = mantém a linha padrão

  for (const t of d.tasks ?? []) {
    const who = t.name ?? t.agentType ?? 'agent';
    const icon = STATUS_ICON[t.status] ?? `${C.dim}${t.status}${C.reset}`;

    // effort pode ser nível (string) ou orçamento de tokens (número)
    const effort = t.effort == null ? 'default' : String(t.effort);

    let ctx = `${C.dim}ctx ?${C.reset}`;
    if (t.contextWindowSize && t.tokenCount != null) {
      const pct = Math.floor((t.tokenCount / t.contextWindowSize) * 100);
      ctx = `${bar(pct)} ${pct}% ${C.dim}(${k(t.tokenCount)}/${k(t.contextWindowSize)})${C.reset}`;
    }

    const content = [
      `${icon} ${C.cyan}${who}${C.reset}`,
      `${shortModel(t.model)}`,
      `${C.magenta}effort:${effort}${C.reset}`,
      ctx,
    ].join(`${C.dim} · ${C.reset}`);

    process.stdout.write(JSON.stringify({ id: t.id, content }) + '\n');
  }
});
