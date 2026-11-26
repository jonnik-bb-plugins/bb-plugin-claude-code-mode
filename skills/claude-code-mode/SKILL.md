---
name: claude-code-mode
description: Start a bb thread in Claude Code's experimental Code Mode, check whether a thread uses it, and troubleshoot the Claude Code Mode plugin.
---

# Claude Code Mode

In Code Mode, Claude writes JavaScript that calls tools: parallel calls,
chaining, and output filtered before it reaches the model.

## When to use

- Use for work with many or noisy tool calls (broad file scans, test-and-fix
  loops with long output).
- Do not use when the thread needs Claude in Chrome, computer use or Remote
  Control, or must run on a machine other than the bb server's. Windows is not
  supported.

Needs Claude Code CLI 2.1.323 or later and Opus 5.5, Sonnet 5.5, Haiku 5.5 or
Fable 5.2.

## Start a thread

Agents and scripts:

```sh
bb claude-code-mode spawn --model claude-sonnet-5-5 --prompt-file brief.md --parent-self
```

- Prints the new thread id. Plain `bb thread spawn` never enables Code Mode.
- `--model` is a plain model id. Never add the deprecated `-codemode` suffix:
  the app composer cannot resolve it and moves the next app message to the
  project's default model.
- Exactly one of `--prompt-file <path>` (UTF-8, up to 256 KiB, no stdin `-`) or
  `--prompt <text>`.
- Omit `--parent-self` outside a thread and pass `--project <id>`.
- `bb claude-code-mode spawn --help` lists all options.

In the app: select Claude Code and a supported model in New thread, turn on the
sticky `</>` button, send the first message. The button never affects agent,
CLI, SDK, plugin or fork threads. Compact layouts hide it.

The mode is fixed at the first launch. Resumes keep it, and a Code Mode thread
resumes only while the plugin is active.

## Check a thread

- UI: a `</> Claude Code Mode` badge above the composer.
- Log: `<bb data dir>/plugins/claude-code-mode/code-mode.log` (default data dir
  `~/.bb`), one `ON`/`OFF` line with a reason per launch.
- A Code Mode session transcript has a `"type":"repl-mode"` line.
- On a machine other than the bb server's, Code Mode is not applied even if an
  opted-in thread shows the badge.

## Troubleshoot

The plugin points `BB_CLAUDE_CODE_EXECUTABLE` at its wrapper for every Claude
Code launch on the bb server's machine. Variables read from the launch
environment:

- `CLAUDE_CODE_MODE_DISABLE=1`: no new session starts in Code Mode; a resumed
  Code Mode session stays in it.
- `BB_CLAUDE_CODE_MODE_LOG=<path>` moves the log; `off` disables it.

`bb plugin disable claude-code-mode` removes the wrapper from all launches; Code
Mode threads then do not resume.
