---
description: Remove as barras do ctx-monitor das configurações do usuário
---

1. Leia o `settings.json` no diretório indicado por `CLAUDE_CONFIG_DIR`, ou em `~/.claude` quando a variável não estiver definida.
2. Salve uma cópia de backup antes de alterar o arquivo.
3. Remova `statusLine` e `subagentStatusLine` somente quando o `command` de cada chave contiver `ctx-monitor`. Preserve todas as outras chaves e configurações de outros renderizadores.
4. Informe que a configuração padrão dos subagentes fornecida pelo plugin some ao desinstalá-lo (`/plugin uninstall ctx-monitor@ctx-monitor`). Se o painel não atualizar, reinicie a sessão.
