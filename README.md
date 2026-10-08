# ctx-monitor

Monitor de contexto para Claude Code. Mostra modelo, effort e uso de tokens na status line do agente principal e no painel de subagentes. Também exibe informações de prompt cache e, quando instalado, do CLI `ai-memory`.

A interface inclui:

- **Agente principal** (status line): modelo, effort e uso da janela de contexto
- **Cada subagente** (painel de agentes): status, tipo, modelo, effort e uso de contexto
- **Prompt cache**: quente/fria, contagem regressiva do TTL, hit ratio, misses e a causa do último
- **ai-memory** (se o CLI estiver no PATH): servidor online/offline, páginas e eventos na fila

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

Execute dentro do Claude Code:

```text
/plugin marketplace add IgorFZ/ctx-monitor
/plugin install ctx-monitor@ctx-monitor
/ctx-monitor:setup        # ativa a barra do agente principal
```

A barra dos subagentes já vem ativa ao habilitar o plugin. A do agente principal
precisa do `/ctx-monitor:setup`, porque plugins só podem declarar
`subagentStatusLine` nas próprias settings — o `statusLine` principal tem que ficar
no `~/.claude/settings.json` do usuário.

## Configuração

Os segmentos de cache e `ai-memory` são opcionais. Para ocultá-los, configure as variáveis de ambiente antes de abrir o Claude Code:

```bash
export CTX_MONITOR_CACHE=0
export CTX_MONITOR_AIMEMORY=0
```

Se o CLI `ai-memory` não estiver no PATH, seu segmento fica oculto automaticamente.

## Remoção

No Claude Code:

```text
/ctx-monitor:uninstall
/plugin uninstall ctx-monitor@ctx-monitor
```

O primeiro comando remove a configuração da status line principal quando ela aponta para o plugin. O segundo remove o plugin. As cópias dos scripts em `~/.claude/ctx-monitor/` podem ser apagadas depois.

## Como funciona

| Peça | O que faz |
| :-- | :-- |
| `settings.json` | Registra `subagentStatusLine` apontando para o script do plugin |
| `hooks/hooks.json` | No `SessionStart`, copia os scripts para `~/.claude/ctx-monitor/` (caminho estável entre updates) |
| `commands/setup.md` | Aponta o `statusLine` do usuário para `~/.claude/ctx-monitor/statusline.js` |
| `commands/uninstall.md` | Remove essa entrada |

## Compatibilidade e limites

- A % dos subagentes é `tokenCount / contextWindowSize` — `tokenCount` é acumulado, então é aproximação. A do principal (`used_percentage`) é exata.
- `effort` dos subagentes é o valor **configurado**; se o modelo não suportar o nível, o efetivo pode diferir.
- Requer Claude Code ≥ 2.1.213 para modelo/effort por subagente e ≥ 2.1.251 para a linha de cache.
- O `ai-memory status --json` é consultado no máximo a cada 30s (cache em arquivo temporário por sessão).
- Requer Node.js 18 ou superior no PATH.

## Desenvolvimento

```bash
claude --plugin-dir ./plugins/ctx-monitor
claude plugin validate ./plugins/ctx-monitor
npm test   # verifica os scripts com entradas simuladas
```

Não há dependências npm. Os scripts usam os módulos nativos do Node.js. Para contribuir, abra uma issue ou um pull request com uma descrição do problema e como reproduzi-lo.

## Licença

[MIT](LICENSE).
