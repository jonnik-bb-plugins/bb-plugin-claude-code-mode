---
name: claude-code-mode
description: Explains the Claude Code Mode plugin - how a bb thread is started in Claude Code's experimental Code Mode and how to check whether a thread uses it.
---

# Claude Code Mode

- Agents and scripts: `bb claude-code-mode spawn --model claude-sonnet-5-5
  --prompt-file brief.md [--parent-self] [--title ...]` (or `--prompt "..."`
  for a short message; no stdin `-`) starts a Code Mode thread and prints its
  id (`bb claude-code-mode spawn --help` lists all options; not
  `bb thread spawn`). Use the plain model id. The `-codemode` model suffix is
  deprecated: the app composer does not know it and moves the next message to
  the project's default model.
- Toggle: the code icon button in the New thread composer toolbar is a sticky
  preference. While on, a Claude Code 5.5 or Fable 5.2 thread whose first
  message a person sends from the app starts in Code Mode. Agent, CLI, SDK,
  plugin and fork threads are never affected by the toggle. The button shows
  only for the Claude Code provider (disabled for older models); compact
  layouts hide it.
- The mode is fixed at the first turn and cannot be switched. A thread running
  in Code Mode shows "Claude Code Mode" above its composer; the wrapper records
  each launch in `threads/<thread id>` (`on`/`off`) beside itself.
- Check: `<bb data dir>/plugins/claude-code-mode/code-mode.log` (default data
  dir `~/.bb`) has one ON/OFF line per launch. A Code Mode transcript has a
  `"type":"repl-mode"` line.
- Wrapper: the plugin copies `claude-code-mode-wrapper` into that same
  directory and points `BB_CLAUDE_CODE_EXECUTABLE` at it for every Claude Code
  launch on the bb server's machine. Disabling or removing the plugin ends
  this, so Code Mode threads then do not resume in Code Mode.
- Environment, read by the wrapper: `CLAUDE_CODE_MODE_DISABLE=1` turns Code
  Mode off; `BB_CLAUDE_CODE_MODE_LOG` moves the log, or disables it with `off`.
