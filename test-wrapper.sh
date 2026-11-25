#!/usr/bin/env bash
# Tests for bin/claude-code-mode-wrapper using a fake real binary that prints argv.
set -u
W="$(cd "$(dirname "$0")" && pwd)/bin/claude-code-mode-wrapper"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
printf '#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done\n' > "$T/fake"; chmod +x "$T/fake"
unset BB_CLAUDE_CODE_MODE CLAUDE_CODE_MODE_DISABLE BB_CLAUDE_CODE_EXECUTABLE CLAUDE_CONFIG_DIR
export BB_CLAUDE_CODE_MODE_REAL_BIN="$T/fake" BB_CLAUDE_CODE_MODE_LOG="$T/log" HOME="$T/h"
mkdir -p "$T/h/.claude/projects/p"
echo '{"type":"repl-mode","replMode":true,"x":1}' > "$T/h/.claude/projects/p/aaa.jsonl"
echo '{"type":"user"}' > "$T/h/.claude/projects/p/bbb.jsonl"
fail=0
chk() { # name, expect-ON(1/0), grep-pattern-extra
  local name=$1 want=$2; shift 2
  local out; out=$("$W" "$@")
  local has=0; grep -q 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE' <<<"$out" && has=1
  if [[ $has == "$want" ]]; then echo "ok   $name"; else echo "FAIL $name"; fail=1; fi
  LAST=$out
}
S='{"env":{"K":"v"},"a":1}'
chk "plain opus-5-5 OFF" 0 --model=claude-opus-5-5 --settings "$S"
[[ $LAST == $'--model=claude-opus-5-5\n--settings\n'"$S" ]] || { echo "FAIL plain argv changed"; fail=1; }
chk "opus suffix ON" 1 --model=claude-opus-5-5-codemode --settings "$S"
grep -qx -- '--model=claude-opus-5-5' <<<"$LAST" && grep -q '"K":"v"' <<<"$LAST" && grep -q '"a":1' <<<"$LAST" || { echo "FAIL opus rewrite/merge"; fail=1; }
chk "separate-arg sonnet suffix ON" 1 --model claude-sonnet-5-5-codemode --settings "$S"
grep -qx 'claude-sonnet-5-5' <<<"$LAST" && ! grep -q codemode <<<"$LAST" || { echo "FAIL separate rewrite"; fail=1; }
chk "fable suffix ON" 1 --model=claude-fable-5-2-codemode --settings "$S"
chk "sonnet[1m] suffix ON" 1 --model='claude-sonnet-5-5[1m]-codemode' --settings "$S"
grep -qxF -- '--model=claude-sonnet-5-5[1m]' <<<"$LAST" || { echo "FAIL [1m] rewrite"; fail=1; }
chk "opus-4-1 suffix OFF stripped" 0 --model=claude-opus-4-1-codemode --settings "$S"
grep -qx -- '--model=claude-opus-4-1' <<<"$LAST" || { echo "FAIL 4-1 strip"; fail=1; }
CLAUDE_CODE_MODE_DISABLE=1 chk "disable suffix OFF stripped" 0 --model=claude-sonnet-5-5-codemode
grep -qx -- '--model=claude-sonnet-5-5' <<<"$LAST" || { echo "FAIL env0 strip"; fail=1; }
chk "resume marker plain model ON" 1 --model=claude-opus-4-1 --resume=aaa --settings "$S"
chk "resume -r form ON" 1 -r aaa --model claude-opus-4-1
chk "resume marker suffixed ON stripped" 1 --model=claude-opus-5-5-codemode --resume=aaa --settings "$S"
grep -qx -- '--model=claude-opus-5-5' <<<"$LAST" || { echo "FAIL resume strip"; fail=1; }
chk "resume no marker OFF" 0 --model=claude-sonnet-5-5-codemode --resume bbb --settings "$S"
grep -qx -- '--model=claude-sonnet-5-5' <<<"$LAST" || { echo "FAIL resume-off strip"; fail=1; }
chk "--settings= form" 1 --model=claude-sonnet-5-5-codemode "--settings=$S"
grep -q '^--settings={' <<<"$LAST" && grep -q '"K":"v"' <<<"$LAST" || { echo "FAIL --settings= merge"; fail=1; }
chk "no --settings appended" 1 --model=claude-sonnet-5-5-codemode
[[ $(tail -2 <<<"$LAST" | head -1) == --settings ]] || { echo "FAIL append position"; fail=1; }
chk "file --settings appended second" 1 --model=claude-sonnet-5-5-codemode --settings /tmp/x.json
grep -qx '/tmp/x.json' <<<"$LAST" && [[ $(grep -c '^--settings$' <<<"$LAST") == 2 ]] || { echo "FAIL file settings"; fail=1; }
export BB_CLAUDE_CODE_MODE=1
chk "env mode new session ON" 1 --model=claude-sonnet-5-5 --settings "$S"
grep -q '"K":"v"' <<<"$LAST" || { echo "FAIL env mode merge"; fail=1; }
chk "env mode incapable model OFF" 0 --model=claude-opus-4-1 --settings "$S"
chk "env mode no --model OFF" 0 --settings "$S"
chk "env mode resume no marker OFF" 0 --model=claude-sonnet-5-5 --resume=bbb
chk "env mode resume marker ON" 1 --model=claude-sonnet-5-5 --resume=aaa
CLAUDE_CODE_MODE_DISABLE=1 chk "disable beats env mode" 0 --model=claude-sonnet-5-5
BB_CLAUDE_CODE_MODE=0 chk "env mode 0 OFF" 0 --model=claude-sonnet-5-5
printf '#!/bin/sh\necho "${BB_CLAUDE_CODE_MODE-unset}"\n' > "$T/envfake"; chmod +x "$T/envfake"
[[ $(BB_CLAUDE_CODE_MODE_REAL_BIN="$T/envfake" "$W" --model=claude-sonnet-5-5) == unset ]] \
  && echo "ok   env mode not inherited" || { echo "FAIL env mode leaked"; fail=1; }
unset BB_CLAUDE_CODE_MODE
[[ -s $T/log ]] || { echo "FAIL log"; fail=1; }
rm "$T/log"; BB_CLAUDE_CODE_MODE_LOG=off "$W" >/dev/null; [[ ! -e $T/log && ! -e off ]] || { echo "FAIL log off"; fail=1; }
mkdir -p "$T/cfg/projects/p"; cp "$T/h/.claude/projects/p/aaa.jsonl" "$T/cfg/projects/p/ccc.jsonl"
CLAUDE_CONFIG_DIR="$T/cfg" chk "CLAUDE_CONFIG_DIR resume ON" 1 --model=claude-sonnet-5-5 --resume=ccc

# Real-binary resolution. Each fake prints its own tag.
unset BB_CLAUDE_CODE_MODE_REAL_BIN
fake() { mkdir -p "$(dirname "$1")"; printf '#!/bin/sh\necho %s\n' "$2" > "$1"; chmod +x "$1"; }
fake "$T/orig/claude" orig; fake "$T/path/claude" path; fake "$T/h/.local/bin/claude" known
mkdir -p "$T/self"; ln -s "$W" "$T/self/claude"
resolve() { local name=$1 want=$2; shift 2; local got; got=$(env "$@" "$W" 2>&1)
  if [[ $got == *"$want"* ]]; then echo "ok   $name"; else echo "FAIL $name: $got"; fail=1; fi; }
BASE=/usr/bin:/bin
resolve "original executable wins" orig PATH="$T/path:$BASE" BB_CLAUDE_CODE_EXECUTABLE="$T/orig/claude"
resolve "plugin-passed original wins" orig PATH="$T/path:$BASE" BB_CLAUDE_CODE_MODE_REAL_BIN="$T/orig/claude" BB_CLAUDE_CODE_EXECUTABLE="$W"
resolve "bare command name" path PATH="$T/path:$BASE" BB_CLAUDE_CODE_EXECUTABLE=claude
resolve "self ignored, PATH used" path PATH="$T/self:$T/path:$BASE" BB_CLAUDE_CODE_EXECUTABLE="$W"
resolve "well-known path" known PATH="$BASE"
resolve "broken original fails" "not runnable" PATH="$T/path:$BASE" BB_CLAUDE_CODE_EXECUTABLE=/nonexistent/claude
rm "$T/h/.local/bin/claude"
if [[ ! -x /opt/homebrew/bin/claude && ! -x /usr/local/bin/claude ]]; then
  resolve "not found message" "Claude Code CLI not found" PATH="$T/self:$BASE"
fi
printf '#!/bin/sh\necho "$BB_CLAUDE_CODE_EXECUTABLE"\n' > "$T/orig/claude"
resolve "child sees real CLI" "$T/orig/claude" BB_CLAUDE_CODE_MODE_REAL_BIN="$T/orig/claude" BB_CLAUDE_CODE_EXECUTABLE="$W"
((fail)) && { echo FAILED; exit 1; }; echo "ALL PASS"
