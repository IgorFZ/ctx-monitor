# ctx-monitor

Monitor de contexto para Claude Code. Mostra modelo, effort e uso de tokens na status line do agente principal e no painel de subagentes. Também exibe prompt cache, limites de uso e, quando instalado, o CLI `ai-memory`. Um painel experimental reúne os links da sessão dentro do terminal.

A interface inclui:

- **Agente principal** (status line): modelo, effort e uso da janela de contexto
- **Cada subagente** (painel de agentes): status, tipo, modelo, effort e uso de contexto
- **Prompt cache**: quente/frio, contagem regressiva do TTL, hit ratio e misses
- **ai-memory** (se o CLI estiver no PATH): servidor online/offline, páginas, fila e link para a interface web
- **Limites de uso**: janelas de 5 horas e 7 dias, com horário de reset
- **Links** (experimental): coleção local com busca, títulos e origem de cada URL

```text
Opus 5.5 · high | ctx ━━━━━───── 52% · 518k/1M
cache 59:15 · hit 98% · misses 3
ai-memory 701 páginas · fila 2
limites 5h 24% · reset 18:40 | 7d 84% · reset 10/10 16:00

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

Os segmentos de cache, `ai-memory` e limites de uso são opcionais. Para ocultá-los, configure as variáveis de ambiente antes de abrir o Claude Code:

```bash
export CTX_MONITOR_CACHE=0
export CTX_MONITOR_AIMEMORY=0
export CTX_MONITOR_RATE_LIMITS=0
```

Se o CLI `ai-memory` não estiver no PATH, seu segmento fica oculto automaticamente. Quando `status --json` informa `client.server_url`, o nome `ai-memory` é um link OSC 8 para o `/web` daquele servidor. Para usar outro endereço:

```bash
export CTX_MONITOR_AIMEMORY_URL=http://localhost:49374/web
```

O link depende de suporte a hyperlinks no terminal. Os limites só aparecem quando o Claude fornece `rate_limits`; não fazemos chamadas extras à API. O horário de reset usa o fuso local e inclui a data quando o reset é em outro dia.

## Links da sessão

Para experimentar o painel nativo, no Claude Code:

```text
/ctx-monitor:setup experimental-links
```

Reinicie a sessão depois do setup. Ele habilita `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` nas variáveis de ambiente das settings, com backup. Também é possível abrir o Claude sem alterar essa opção nas settings:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

Quando houver links, aparece um botão `Links · N` acima do prompt. Clicar nele, ou executar `/ctx-links`, abre o painel. A lista tem busca por título, URL ou origem, ordena os links mais recentes primeiro e remove duplicatas. `Esc` fecha o painel. O Claude decide o posicionamento: lateral no modo fullscreen, ou acima do prompt no layout principal, conforme o espaço disponível.

A coleta usa URLs das mensagens e dos resultados das ferramentas, incluindo saída do `gh` e de ferramentas MCP. Títulos de links Markdown e de resultados JSON são preservados. IDs isolados como `#123` não viram links. A coleção não consulta os destinos nem publica dados e guarda até 300 URLs na memória da sessão.

Alternativas em texto:

```text
/ctx-links list
/ctx-monitor:links
```

A primeira usa o mod; a segunda lê o transcript local da sessão, registrado pelo hook `SessionStart`, e funciona sem os function hooks. Nenhuma das duas abre os links automaticamente.

O painel foi validado no Claude Code 2.1.294 e 2.1.295. A [API de mods](https://github.com/anthropics/claude-code/blob/main/mods/README.md) está em acesso antecipado e pode mudar. O plugin mantém o comando em texto para sessões em que o painel não estiver disponível.

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
| `hooks/links.ts` | Coleta links e desenha o botão e o painel nativo |
| `commands/links.md` | Mostra os links na conversa a partir do transcript local |
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
npm test   # scripts, coleta de links e configuração
claude plugin test ./plugins/ctx-monitor   # botão, painel, busca e fechamento
```

Não há dependências npm. Os scripts usam os módulos nativos do Node.js. Para contribuir, abra uma issue ou um pull request com uma descrição do problema e como reproduzi-lo.

Para verificar os tipos do mod, o Claude gera `.claude-plugin/types/` ao validar ou carregar o plugin. Depois execute `npx -p typescript tsc -p plugins/ctx-monitor`.

## Licença

[MIT](LICENSE).
