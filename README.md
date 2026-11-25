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

Only a first message that a person sends from the app is affected. Threads
started by agents, the CLI, the SDK, plugins or forks are not.

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
ids of opted-in threads, and the environment resolver adds
`BB_CLAUDE_CODE_MODE=1` for them. The wrapper then adds
`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` through `--settings` and runs the real
CLI. Resumes keep Code Mode only when the session transcript records it. The
variable `BB_CLAUDE_CODE_MODE` is not passed on to Claude Code.

The real CLI is the `BB_CLAUDE_CODE_EXECUTABLE` that bb's server had before the
plugin, else `claude` on `PATH`, else `~/.local/bin/claude`,
`~/.claude/local/claude`, `/opt/homebrew/bin/claude` or
`/usr/local/bin/claude`.

The wrapper also accepts a `-codemode` suffix on the model id (for example
`claude-sonnet-5-5-codemode`) as an opt-in for scripted launches. It strips the
suffix before Claude Code runs.

## Log and switches

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
