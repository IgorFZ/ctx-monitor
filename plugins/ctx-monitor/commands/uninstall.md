---
description: Remove a barra de contexto principal do settings.json do usuário
---

1. Leia `~/.claude/settings.json`.
2. Remova a chave `statusLine` somente se o `command` dela contiver `ctx-monitor`; caso contrário, avise o usuário e não altere nada.
3. Preserve todas as outras chaves.
4. Diga ao usuário que a barra dos subagentes some ao desabilitar o plugin (`/plugin disable ctx-monitor`).
