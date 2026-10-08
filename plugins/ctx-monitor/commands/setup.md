---
description: Configura as barras de contexto do agente principal e dos subagentes
---

Configure as duas barras do ctx-monitor.

1. Leia o `settings.json` no diretório indicado por `CLAUDE_CONFIG_DIR`, ou em `~/.claude` quando a variável não estiver definida.
2. Confira as chaves `statusLine` e `subagentStatusLine`. Se alguma existir e o `command` não contiver `ctx-monitor`, mostre os comandos atuais e peça confirmação para substituí-los. Se o usuário já pediu explicitamente para trocar essas barras pelo ctx-monitor, prossiga.
3. Rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js"`. Use `--replace` se a substituição de uma configuração existente foi autorizada. O script faz backup e preserva as outras chaves.
4. Confira se o comando terminou com sucesso. Não afirme que configurou as barras se houve erro.
5. Informe que as duas barras foram configuradas. Se o painel continuar com as linhas padrão, peça para reiniciar a sessão; `/reload-plugins` pode não atualizar o comando dos subagentes na sessão atual.
