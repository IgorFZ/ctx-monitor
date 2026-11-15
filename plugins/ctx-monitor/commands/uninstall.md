---
description: Removes the ctx-monitor bars from the user settings
---

1. Read `settings.json` in the directory given by `CLAUDE_CONFIG_DIR`, or in `~/.claude` when the variable is not set.
2. Save a backup copy before changing the file.
3. Remove `statusLine` and `subagentStatusLine` only when each key's `command` contains `ctx-monitor`. Preserve every other key and other renderers' settings.
4. Tell the user that the plugin's default subagent setting goes away when it is uninstalled (`/plugin uninstall ctx-monitor@ctx-monitor`). If the panel does not update, restart the session.
