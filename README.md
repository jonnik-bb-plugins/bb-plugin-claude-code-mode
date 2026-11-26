# Claude Code Mode for bb

A [bb](https://getbb.app) plugin that starts a single Claude Code thread in
Claude Code's experimental Code Mode, without changing your other threads.

This is an independent community plugin. It is not made or endorsed by
Anthropic.

## Use

1. Install:

   ```sh
   bb plugin install 'git:https://github.com/jonnik-bb-plugins/bb-plugin-claude-code-mode.git@semver:^0.1.0'
   ```

2. In the New thread composer, pick the Claude Code provider and a supported
   model (Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.2).
3. Press the code icon button. It stays on until you press it again.
4. Send the first message. The thread shows "Claude Code Mode" above its
   composer.

The button affects only a first message that a person sends from the app.
Threads started by agents, the CLI, the SDK, other plugins or forks are not.

## From the CLI or an agent

```sh
bb claude-code-mode spawn --model claude-sonnet-5-5 --prompt-file brief.md --parent-self
```

It starts a Claude Code thread in Code Mode with a plain model id, whatever the
button says, and prints the thread id. `--model` and exactly one of
`--prompt-file <path>` or `--prompt <text>` are required. The file is read on the
machine of the calling thread (outside a thread, the bb server's), must be
non-empty UTF-8 of at most 256 KiB, and cannot be stdin (`-`). Other options:
`--project` (default: the current thread's), `--parent-self` or `--parent-thread`, `--title`,
`--reasoning-level`, `--permission-mode`, `--environment` or
`--new-environment personal|worktree` (with `--base-branch`), and `--json`.
Without an environment option bb picks the project's default.
`bb thread spawn` itself does not start Code Mode.

## Requirements

- Claude Code CLI 2.1.323 or later, signed in.
- A supported model, listed above.
- macOS or Linux with `bash`, and `python3` to merge Claude Code settings.
- The thread runs on the same machine as the bb server.

## Limits

- Code Mode is an experimental Claude Code feature. It can change or disappear
  in any Claude Code release.
- Code Mode threads do not have Claude in Chrome, computer use or Remote
  Control.
- While the plugin is enabled, every Claude Code launch on the bb server's
  machine goes through its wrapper script. Launches without the opt-in are
  passed to Claude Code with Code Mode untouched.
- A Code Mode thread resumes in Code Mode only while the plugin is active.
- The mode is fixed at the first turn and cannot be switched later.
- The toolbar button and the thread banner do not check which machine a thread
  runs on. On another enrolled machine the banner appears, but Code Mode is not
  applied.
- Compact layouts hide the toolbar button.

## How it works

On startup the plugin copies `bin/claude-code-mode-wrapper` into its data
directory (`<bb data dir>/plugins/claude-code-mode/`) and sets
`BB_CLAUDE_CODE_EXECUTABLE` to that copy. A `message.dispatch` hook stores the
ids of opted-in threads (the button, or this plugin as the spawn origin), and
the environment resolver adds `BB_CLAUDE_CODE_MODE=1` for them. The wrapper
then adds
`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` through `--settings` and runs the real
CLI. Resumes keep Code Mode only when the session transcript records it. The
variable `BB_CLAUDE_CODE_MODE` is not passed on to Claude Code.

The real CLI is the `BB_CLAUDE_CODE_EXECUTABLE` that bb's server had before the
plugin, else `claude` on `PATH`, else `~/.local/bin/claude`,
`~/.claude/local/claude`, `/opt/homebrew/bin/claude` or
`/usr/local/bin/claude`.

Deprecated: the wrapper also accepts a `-codemode` suffix on the model id (for
example `claude-sonnet-5-5-codemode`) and strips it before Claude Code runs. Do
not use it for threads you continue in the app: the composer does not know that
id, falls back to the project's default model, and the next message sent from
the app runs on it. Use `bb claude-code-mode spawn`.

## Log and switches

The thread banner shows the mode of the latest launch: for each thread the
wrapper records `on` or `off` in `threads/<thread id>` beside its copy, so a
`-codemode` or resumed thread shows it too, and a disabled opt-in does not.
Before the first launch, the banner follows the toolbar opt-in.

Each launch adds one line (time, session, model, ON or OFF, reason) to
`code-mode.log` beside the wrapper copy. No prompt text is logged.

| Variable | Effect |
| --- | --- |
| `CLAUDE_CODE_MODE_DISABLE=1` | Turns Code Mode off. |
| `BB_CLAUDE_CODE_MODE_LOG=<path>` | Writes the log elsewhere. |
| `BB_CLAUDE_CODE_MODE_LOG=off` | Disables the log. |

## Develop

```sh
npm install
npm test
npm run typecheck
bb plugin build .
bb plugin install .
```

MIT license.
