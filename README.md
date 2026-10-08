# ctx-monitor

Plugin do Claude Code que mostra, em tempo real:

- **Agente principal** (status line): modelo · effort · barra de uso da janela de contexto
- **Cada subagente** (painel de agentes): status · tipo · modelo · effort · barra de contexto
- **Prompt cache**: quente/fria, contagem regressiva do TTL, hit ratio, misses e a causa do último
- **ai-memory** (se o CLI estiver no PATH): servidor online/offline, páginas, sessões, eventos na fila

Desligue segmentos com `CTX_MONITOR_CACHE=0` ou `CTX_MONITOR_AIMEMORY=0`.

```
Opus · effort:high · █████████████░░░░░░░ 67% (134k/200k)
● Explore · haiku-5-5 · effort:low · ███░░░░░░░░░ 21% (42k/200k)
✓ reviewer · sonnet-5-5 · effort:default · ███████████░ 91% (910k/1.0M)
```

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
