---
description: Sets up the context bars and, optionally, the experimental native panels
argument-hint: "[experimental-links]"
---

Set up both ctx-monitor bars.

1. Read `settings.json` in the directory given by `CLAUDE_CONFIG_DIR`, or in `~/.claude` when the variable is not set.
2. Check the `statusLine` and `subagentStatusLine` keys. If either exists and its `command` does not contain `ctx-monitor`, show the current commands and ask for confirmation before replacing them. If the user already explicitly asked to replace those bars with ctx-monitor, proceed.
3. If the arguments are `experimental-links`, also pass `--experimental-links`. This enables function hooks in `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, preserving other variables; tell the user Claude Code must be restarted.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js"`. Pass `--replace` if replacing an existing configuration was authorized. The script makes a backup and preserves other keys.
5. Check that the command succeeded. Do not claim the bars were configured if there was an error.
6. Report that both bars were configured. If the panel still shows the default lines, ask the user to restart the session; `/reload-plugins` may not update the subagent command in the current session.

Arguments received: $ARGUMENTS. Accept only `experimental-links`; never pass free-form arguments to the shell.
