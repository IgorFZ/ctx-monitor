# ctx-monitor

Context monitor for Claude Code. Shows model, effort and token usage in the main agent's status line and in the subagent panel. It also shows the prompt cache, usage limits and, when installed, the `ai-memory` CLI. Experimental native panels collect the session's links and show an environment sidebar with the state of the machine, sessions, ports and containers.

The interface includes:

- **Main agent** (status line): model, effort and context window usage
- **Each subagent** (agent panel): status, type, model, effort and context usage
- **Prompt cache**: warm/cold, TTL countdown, hit ratio and misses
- **ai-memory** (if the CLI is on the PATH): server online/offline, pages, queue and a link to the web UI
- **Usage limits**: 5-hour and 7-day windows, with reset time
- **Links** (experimental): local collection with search, titles and the source of each URL
- **Environment** (experimental): sidebar with CPU, RAM, GPU, workspace, sessions, request progress, ports and containers

```text
Opus 5.5 · high | ctx ━━━━━───── 52% · 518k/1M
cache 59:15 · hit 98% · misses 3
ai-memory 701 pages · queue 2
limits 5h 24% · reset 18:40 | 7d 84% · reset Oct 10 16:00

Explore | haiku-5-5 · low | ctx ━━────── ~21% · 42k/200k
reviewer | sonnet-5-5 | ctx ━━━━━━━─ ~91% · 910k/1M
```

Context is green below 60%, yellow from 60% and red from 85%. The cache line shows the time left, the hit ratio and the number of misses. The `ai-memory` integration shows pages or an offline state, plus the pending queue.

## Installation

Run inside Claude Code:

```text
/plugin marketplace add IgorFZ/ctx-monitor
/plugin install ctx-monitor@ctx-monitor
/ctx-monitor:setup
```

Setup configures both bars in the user's `settings.json`, makes a backup and preserves other options. If another renderer is configured, it asks for confirmation before replacing it. The default directory is `~/.claude`; `CLAUDE_CONFIG_DIR` is also honored.

## Updating

```text
/plugin marketplace update ctx-monitor
/plugin update ctx-monitor@ctx-monitor
/ctx-monitor:setup
```

Restart the session if the subagent panel still shows the default lines. The plugin uses local copies at a stable path, without depending on `${CLAUDE_PLUGIN_ROOT}` in the settings commands.

## Configuration

The cache, `ai-memory` and usage limit segments are optional. To hide them, set these environment variables before starting Claude Code:

```bash
export CTX_MONITOR_CACHE=0
export CTX_MONITOR_AIMEMORY=0
export CTX_MONITOR_RATE_LIMITS=0
```

If the `ai-memory` CLI is not on the PATH, its segment is hidden automatically. When `status --json` reports `client.server_url`, the `ai-memory` label is an OSC 8 link to that server's `/web`. To use another address:

```bash
export CTX_MONITOR_AIMEMORY_URL=http://localhost:49374/web
```

The link depends on hyperlink support in the terminal. Limits only appear when Claude provides `rate_limits`; no extra API calls are made. The reset time uses the local time zone and includes the date when the reset is on another day.

## Session links

To try the native panel, in Claude Code:

```text
/ctx-monitor:setup experimental-links
```

Restart the session after setup. It enables `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the settings' environment variables, with a backup. You can also start Claude without changing that setting:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

When there are links, a `Links · N` button appears above the prompt. Clicking it, or running `/ctx-links`, opens the panel. The list can be searched by title, URL or source, shows the newest links first and removes duplicates. `Esc` closes the panel. Claude decides the placement: beside the conversation in fullscreen mode, or above the prompt in the main layout, depending on the available space.

Collection uses URLs from messages and tool results, including `gh` and MCP tool output. Titles from Markdown links and JSON results are kept. Bare IDs like `#123` do not become links. The collection never fetches the targets or publishes data, and keeps up to 300 URLs in the session's memory.

Text alternatives:

```text
/ctx-links list
/ctx-monitor:links
```

The first uses the mod; the second reads the session's local transcript, recorded by the `SessionStart` hook, and works without function hooks. Neither opens links automatically.

The panels were validated on Claude Code 2.1.322 (Windows) and 2.1.325 (Linux); 2.1.295 does not load this plugin's hooks module. The [mods API](https://github.com/anthropics/claude-code/blob/main/mods/README.md) is in early access and may change. The plugin keeps the text command for sessions where the panel is unavailable.

## Environment sidebar

A sidebar with the state of the machine and the session, refreshed while it is open:

- **PC**: CPU and RAM usage; CPU temperature (`sensors`, Linux) and NVIDIA GPU (`nvidia-smi`), when available
- **Workspace**: path and branch, with commits ahead of and behind the upstream
- **Model**: active model, context, session cost, total cost accumulated across sessions, cache read and the 5-hour and 7-day limits
- **Sessions**: the current one and the other Claude Code sessions open on the machine
- **Progress**: elapsed time of the request in progress against an estimate made by Haiku (one small call per request)
- **Ports** and **containers** (`docker ps`), with buttons to kill the process or stop the container

It also uses function hooks (see the previous section). Open it with `/environment`. In fullscreen mode (`CLAUDE_CODE_NO_FLICKER=1 claude`) with 110 columns or more, the sidebar opens by itself beside the chat; otherwise it appears above the prompt. To toggle it with `ctrl+x ctrl+x`, add this to `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Global", "bindings": { "ctrl+x ctrl+x": "app:toggleReplTab" } }
  ]
}
```

| | Linux and WSL | Windows |
| :-- | :-- | :-- |
| CPU and RAM | `/proc` | PowerShell (`Get-CimInstance`) |
| CPU temperature | `sensors` (lm-sensors) | not shown |
| GPU | `nvidia-smi` | `nvidia-smi` |
| Ports | `ss` | PowerShell (`Get-NetTCPConnection`), without system services |
| Sessions | `~/.claude/sessions` with a live process | same, checked against `Get-Process` |
| Containers | `docker` | `docker` (Docker Desktop) |
| Kill button | `kill <pid>` | `taskkill /PID <pid> /F` (forced) |
| Refresh | every 1s | every 3s (each PowerShell call takes about a second) |

A section whose command is missing stays empty. On WSL the sidebar shows the Linux side; ports forwarded to Windows appear there as `wslrelay`.

## Removal

In Claude Code:

```text
/ctx-monitor:uninstall
/plugin uninstall ctx-monitor@ctx-monitor
```

The first command removes both bars' settings when they point to the plugin. The second removes the plugin. The script copies in `~/.claude/ctx-monitor/` can be deleted afterwards.

## How it works

| Piece | What it does |
| :-- | :-- |
| `settings.json` | Registers `subagentStatusLine` using the local copy of the script |
| `hooks/hooks.json` | On `SessionStart`, copies the renderers and the formatting module to `~/.claude/ctx-monitor/` (a path that stays stable across updates) |
| `commands/setup.md` | Runs `scripts/setup.js`, which configures both bars and saves a backup |
| `hooks/index.ts` | The single hooks module: combines the events the links and environment features share |
| `hooks/links.ts` | Collects links and draws the button and the native panel |
| `hooks/environment/` | Collects the machine and session state and draws the environment sidebar |
| `commands/links.md` | Shows the links in the conversation from the local transcript |
| `commands/uninstall.md` | Removes both entries when they belong to ctx-monitor |

## Compatibility and limits

- The subagent percentage, marked with `~`, is `tokenCount / contextWindowSize` — `tokenCount` is cumulative, so it is an approximation. The main agent's (`used_percentage`) is exact.
- Subagent `effort` is the **configured** value; if the model does not support that level, the effective one may differ.
- Requires Claude Code ≥ 2.1.213 for per-subagent model/effort and ≥ 2.1.251 for the cache line. The subagent type (`agentType`) is reported from 2.1.293.
- `ai-memory status --json` is queried at most every 30s (cached in a per-session temp file).
- Requires Node.js 18 or newer on the PATH. The status line, setup and links scripts run on Linux, macOS and Windows; the environment sidebar supports Linux (including WSL) and Windows.

## Development

```bash
claude --plugin-dir ./plugins/ctx-monitor
claude plugin validate ./plugins/ctx-monitor
npm test   # scripts, link collection and setup
claude plugin test ./plugins/ctx-monitor   # links panel and environment collectors
```

There are no npm dependencies. The scripts use Node.js built-in modules. To contribute, open an issue or a pull request describing the problem and how to reproduce it.

To type-check the mod, Claude generates `.claude-plugin/types/` when it validates or loads the plugin. Then run `npx -p typescript tsc -p plugins/ctx-monitor`.

## License

[MIT](LICENSE).
