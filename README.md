# ctx-monitor

Plugin do Claude Code que mostra, em tempo real:

- **Agente principal** (status line): modelo · effort · barra de uso da janela de contexto
- **Cada subagente** (painel de agentes): status · tipo · modelo · effort · barra de contexto
- **Prompt cache**: quente/fria, contagem regressiva do TTL, hit ratio, misses e a causa do último
- **ai-memory** (se o CLI estiver no PATH): servidor online/offline, páginas, sessões, eventos na fila

Desligue segmentos com `CTX_MONITOR_CACHE=0` ou `CTX_MONITOR_AIMEMORY=0`.

```
◆ Opus ⚙ high ◕ 67% 134k  ⏲ 42:12 ↺ 91% ✕2:tools_changed  ⛁ 1.2k ⧗3
● Explore haiku low ◔ 21% 42k
✓ reviewer sonnet ● 91% 910k
```

| Ícone | Significado |
| :-- | :-- |
| ◆ / ⚙ | modelo / effort |
| ○ ◔ ◑ ◕ ● | uso da janela de contexto (cor: verde < 60%, amarelo < 85%, vermelho) |
| ⏲ | cache quente — tempo até expirar o TTL |
| ❄ ↻ | cache fria — tokens que a próxima requisição vai reescrever |
| ↺ | hit ratio da prompt cache |
| ✕N | misses de cache, com a causa do último |
| ⛁ / ⧗ | páginas no ai-memory / eventos na fila local (servidor fora do ar) |

## Instalação

```bash
/plugin marketplace add <seu-usuario>/ctx-monitor
/plugin install ctx-monitor@ctx-monitor
/ctx-monitor:setup        # ativa a barra do agente principal
```

A barra dos subagentes já vem ativa ao habilitar o plugin. A do agente principal
precisa do `/ctx-monitor:setup`, porque plugins só podem declarar
`subagentStatusLine` nas próprias settings — o `statusLine` principal tem que ficar
no `~/.claude/settings.json` do usuário.

## Como funciona

| Peça | O que faz |
| :-- | :-- |
| `settings.json` | Registra `subagentStatusLine` apontando para o script do plugin |
| `hooks/hooks.json` | No `SessionStart`, copia os scripts para `~/.claude/ctx-monitor/` (caminho estável entre updates) |
| `commands/setup.md` | Aponta o `statusLine` do usuário para `~/.claude/ctx-monitor/statusline.js` |
| `commands/uninstall.md` | Remove essa entrada |

## Ressalvas

- A % dos subagentes é `tokenCount / contextWindowSize` — `tokenCount` é acumulado, então é aproximação. A do principal (`used_percentage`) é exata.
- `effort` dos subagentes é o valor **configurado**; se o modelo não suportar o nível, o efetivo pode diferir.
- Requer Claude Code ≥ 2.1.213 para modelo/effort por subagente e ≥ 2.1.251 para a linha de cache.
- O `ai-memory status --json` é consultado no máximo a cada 30s (cache em arquivo temporário por sessão).
- Requer `node` no PATH.

## Desenvolvimento

```bash
claude --plugin-dir ./plugins/ctx-monitor
claude plugin validate ./plugins/ctx-monitor
npm test   # roda os scripts contra JSON simulado
```
