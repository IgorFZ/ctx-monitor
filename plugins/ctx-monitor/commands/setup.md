---
description: Ativa a barra de contexto do agente principal no settings.json do usuário
---

Configure a status line principal do ctx-monitor no settings do usuário.

1. Rode `node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.js"` para garantir que `~/.claude/ctx-monitor/statusline.js` existe.
2. Leia `~/.claude/settings.json` (crie com `{}` se não existir).
3. Se já existir uma chave `statusLine` apontando para outro script, mostre o valor atual ao usuário e pergunte se pode substituir antes de continuar.
4. Defina, preservando todas as outras chaves do arquivo:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node ~/.claude/ctx-monitor/statusline.js",
     "refreshInterval": 1
   }
   ```
5. Confirme ao usuário em uma frase que a barra aparece na próxima atualização da interface.
