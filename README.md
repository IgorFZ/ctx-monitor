# ctx-monitor

Monitor de contexto para Claude Code. Mostra modelo, effort e uso de tokens na status line do agente principal e no painel de subagentes. Também exibe informações de prompt cache e, quando instalado, do CLI `ai-memory`.

A interface inclui:

- **Agente principal** (status line): modelo, effort e uso da janela de contexto
- **Cada subagente** (painel de agentes): status, tipo, modelo, effort e uso de contexto
- **Prompt cache**: quente/frio, contagem regressiva do TTL, hit ratio e misses
- **ai-memory** (se o CLI estiver no PATH): servidor online/offline, páginas e eventos na fila

```text
Opus 5.5 · high | ctx ━━━━━───── 52% · 518k/1M
cache 59:15 · hit 98% · misses 3 | memory offline · fila 2

Explore | haiku-5-5 · low | ctx ━━────── ~21% · 42k/200k
reviewer | sonnet-5-5 | ctx ━━━━━━━─ ~91% · 910k/1M
```

O contexto fica verde abaixo de 60%, amarelo a partir de 60% e vermelho a partir de 85%. A linha de cache mostra o tempo restante, a taxa de acerto e o número de misses. A integração com `ai-memory` mostra páginas ou estado offline, além da fila pendente.

## Instalação

Execute dentro do Claude Code:

```text
/plugin marketplace add IgorFZ/ctx-monitor
/plugin install ctx-monitor@ctx-monitor
/ctx-monitor:setup
```

O setup configura as duas barras no `settings.json` do usuário, faz backup e preserva as outras opções. Se houver outro renderizador configurado, pede confirmação antes de substituí-lo. O diretório padrão é `~/.claude`; `CLAUDE_CONFIG_DIR` também é respeitado.

## Atualização

```text
/plugin marketplace update ctx-monitor
/plugin update ctx-monitor@ctx-monitor
/ctx-monitor:setup
```

Reinicie a sessão se o painel dos subagentes continuar com as linhas padrão. O plugin usa cópias locais em um caminho estável, sem depender de `${CLAUDE_PLUGIN_ROOT}` nos comandos das settings.

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

O primeiro comando remove as configurações das duas barras quando apontam para o plugin. O segundo remove o plugin. As cópias dos scripts em `~/.claude/ctx-monitor/` podem ser apagadas depois.

## Como funciona

| Peça | O que faz |
| :-- | :-- |
| `settings.json` | Registra `subagentStatusLine` usando a cópia local do script |
| `hooks/hooks.json` | No `SessionStart`, copia os renderizadores e o módulo de formatação para `~/.claude/ctx-monitor/` (caminho estável entre updates) |
| `commands/setup.md` | Executa `scripts/setup.js`, que configura as duas barras e salva backup |
| `commands/uninstall.md` | Remove as duas entradas quando pertencem ao ctx-monitor |

## Compatibilidade e limites

- A % dos subagentes, marcada com `~`, é `tokenCount / contextWindowSize` — `tokenCount` é acumulado, então é aproximação. A do principal (`used_percentage`) é exata.
- `effort` dos subagentes é o valor **configurado**; se o modelo não suportar o nível, o efetivo pode diferir.
- Requer Claude Code ≥ 2.1.213 para modelo/effort por subagente e ≥ 2.1.251 para a linha de cache. O tipo do subagente (`agentType`) é informado a partir da versão 2.1.293.
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
