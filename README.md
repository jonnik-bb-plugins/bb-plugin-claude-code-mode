# Claude Code Mode for bb

A [bb](https://getbb.app) plugin that starts individual Claude Code threads in
Claude Code's experimental Code Mode. Your other threads keep the normal mode.

This is an independent community plugin. It is not made or endorsed by
Anthropic.

## What it is

In Code Mode, Claude writes JavaScript that calls tools. It can run calls in
parallel, chain them, and filter their output before it reaches the model.
bb's Claude Code provider cannot turn this on for its SDK sessions, so the
plugin does it per thread through a bundled wrapper around the Claude Code CLI.

## When to use it

Use it for work with many or noisy tool calls, such as scanning many files or a
test-and-fix loop with long output.

Do not use it when you need Claude in Chrome, computer use or Remote Control,
when the thread runs on a machine other than the bb server's, or when you cannot
accept an experimental feature.

Our own runs with Sonnet 5.5, as an indication only (not a benchmark or a
guarantee):

| Task | Code Mode input tokens | Normal input tokens |
| --- | --- | --- |
| Scan of 40 files | 82k (2 model turns) | 301k (5 model turns) |
| Noisy test-and-fix | 171k | 240k |

Most input tokens are prompt-cache reads, so the cost saving is smaller than
the token saving.

## Requirements

- bb 0.50 or later.
- Claude Code CLI 2.1.323 or later, signed in.
- Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.2.
- macOS or Linux with `bash` and `python3`. Windows is not supported.
- A thread that runs on the same machine as the bb server.

## Install

```sh
bb plugin install 'git:https://github.com/jonnik-bb-plugins/bb-plugin-claude-code-mode.git@semver:^0.1.0'
```

## Start a thread in Code Mode

The mode is chosen when the thread starts and cannot be switched later.

### In the app

1. In the New thread composer, select Claude Code and a supported model.
2. Press the `</>` button in the toolbar. It is a sticky preference: it stays
   on until you press it again.
3. Send the first message.

The button shows only when Claude Code is selected. For an unsupported model it
is disabled and its tooltip says why. It applies only to a first message that a
person sends from the app. Threads started by agents, the CLI, the SDK, other
plugins or forks are not affected. Compact layouts hide the button.

### From the CLI or an agent

```sh
bb claude-code-mode spawn --model claude-sonnet-5-5 --prompt-file brief.md --parent-self
```

The command starts a Claude Code thread in Code Mode, whatever the button says,
and prints the thread id. Plain `bb thread spawn` never enables Code Mode.

- `--model` is required: a plain model id.
- Pass exactly one of `--prompt-file <path>` or `--prompt <text>`. The file is
  read on the machine of the calling thread (outside a thread, the bb
  server's). It must be non-empty UTF-8 of at most 256 KiB; stdin (`-`) is not
  supported.
- `--parent-self` needs a calling thread. Omit it outside a thread, and pass
  `--project <id>` there.
- Other options: `--project` (default: the current thread's), `--parent-thread`,
  `--title`, `--reasoning-level`, `--permission-mode`, `--environment` or
  `--new-environment personal|worktree` (with `--base-branch`), and `--json`.
  Without an environment option bb uses the project's default.

`bb claude-code-mode spawn --help` lists all options.

## Check that a thread is in Code Mode

A thread in Code Mode shows a `</> Claude Code Mode` badge above its composer.
It appears without a reload.

The badge follows the mode of the latest launch, which the wrapper records.
Before a launch is recorded, it follows the opt-in. For an authoritative check,
read the log (see [Troubleshooting](#troubleshooting)): each launch has an `ON`
or `OFF` line.

## Limits

- Code Mode is an experimental Claude Code feature, and the plugin uses
  experimental bb plugin APIs. Either can change or disappear in a release.
- Code Mode threads do not have Claude in Chrome, computer use or Remote
  Control.
- The mode is fixed at the first launch. A resumed session keeps it; the wrapper
  detects it from the session transcript.
- A Code Mode thread resumes only while the plugin is active.
- While the plugin is enabled, every Claude Code launch on the bb server's
  machine goes through its wrapper. Launches without the opt-in run without
  Code Mode.
- Other enrolled machines get no wrapper, so Code Mode is not applied there. A
  thread opted in for such a machine can still show the badge, because no
  launch is recorded for it.

## Troubleshooting

The log is `code-mode.log` in the plugin's data directory,
`<bb data dir>/plugins/claude-code-mode/` (by default
`~/.bb/plugins/claude-code-mode/code-mode.log`). Each launch adds one line:
time, session, model, `ON` or `OFF`, and the reason. No prompt text is logged.

| Symptom | Check |
| --- | --- |
| No badge, or `OFF` in the log | The reason column. Check the model, how the thread was started, and that it runs on the bb server's machine. |
| No log line at all | `bb plugin list` shows the plugin running; the thread runs on the bb server's machine. |
| Claude Code does not start | The wrapper needs a runnable Claude Code CLI (see below). |

Environment variables read by the wrapper. It inherits them from the Claude Code
launch environment:

| Variable | Effect |
| --- | --- |
| `CLAUDE_CODE_MODE_DISABLE=1` | No new session starts in Code Mode. A resumed Code Mode session stays in Code Mode. |
| `BB_CLAUDE_CODE_MODE_LOG=<path>` | Writes the log elsewhere. |
| `BB_CLAUDE_CODE_MODE_LOG=off` | Disables the log. |

To remove the wrapper from all launches, disable the plugin
(`bb plugin disable claude-code-mode`). Code Mode threads then do not resume.

## How it works

On startup the plugin copies `bin/claude-code-mode-wrapper` into its data
directory and sets `BB_CLAUDE_CODE_EXECUTABLE` to that copy. A
`message.dispatch` hook stores the ids of opted-in threads (the button, or this
plugin as the spawn origin), and the environment resolver adds
`BB_CLAUDE_CODE_MODE=1` for them. The wrapper then adds
`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` through `--settings` and runs the real
CLI. `BB_CLAUDE_CODE_MODE` is not passed on to Claude Code.

The real CLI is the `BB_CLAUDE_CODE_EXECUTABLE` that bb's server had before the
plugin, else `claude` on `PATH`, else `~/.local/bin/claude`,
`~/.claude/local/claude`, `/opt/homebrew/bin/claude` or
`/usr/local/bin/claude`.

Deprecated: the wrapper also accepts a `-codemode` suffix on the model id and
strips it before Claude Code runs. Do not use it: the app composer cannot
resolve that id and silently switches the thread to the project's default model
on the next message sent from the app. Use `bb claude-code-mode spawn`.

## Develop

```sh
npm install
npm test
npm run typecheck
bb plugin build .
bb plugin install .
```

MIT license.
