# ctx-monitor for OpenCode

TUI plugin for OpenCode using `@opencode-ai/plugin/tui`.

## Features
- **Status bar (`app_bottom` slot):** Active model, context usage bar & percentage, `ai-memory` page/queue count, and git branch.
- **Sidebar (`sidebar_content` slot):** Context usage, CPU load, RAM usage, session link count, changed file count, and `ai-memory` status.
- **Slash commands:** `/ctx-links` (browse URLs from the current session) and `/ctx-env` (environment & `ai-memory` summary).

## Installation
Add the local plugin path to `~/.config/opencode/tui.json` (or `opencode.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/home/igorfz/projects/ctx-monitor/plugins/ctx-monitor-opencode/src/tui.tsx"
  ]
}
```
