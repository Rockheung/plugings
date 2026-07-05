#!/bin/bash
# confirm-gate — Gates specific Bash commands with a 15-second native dialog.
#
# Timeout (lazy) default differs per command class:
#   DENY  on timeout: irreversible or explicitly forbidden (sudo, pkill, git destructive locals)
#   ALLOW on timeout: reversible and no service impact (kill/killall, git push, git rebase -i, git add -i)
#
# Outputs PreToolUse permissionDecision JSON. Exit 0 with no output = "no opinion" (defer to normal flow).
#
# Korean/UTF-8 safety: the command text is passed to osascript via a UTF-8 temp file read
# (`read ... as «class utf8»`), NOT via `system attribute`/env var — the env-var path mangles
# multibyte text into mojibake. Buttons/title/timeout stay ASCII (argv).

set -uo pipefail

# --- log (rotating, overridable) ---------------------------------------------
LOG="${CONFIRM_GATE_LOG:-$HOME/.claude/confirm-gate.log}"
LOG_MAX_BYTES="${CONFIRM_GATE_LOG_MAX_BYTES:-524288}"  # 512 KiB
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
# rotate: keep last 200 lines once over the cap
if [ -f "$LOG" ]; then
  sz=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  if [ "${sz:-0}" -gt "$LOG_MAX_BYTES" ]; then
    tail -n 200 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi
fi
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG" 2>/dev/null; }

log "=== invoked (pid=$$) ==="

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
log "command: $COMMAND"

# --- classify -----------------------------------------------------------------
GATED_DENY=(
  '^sudo( |$)'
  '^pkill( |$)'
  '^git reset --hard( |$)'
  '^git clean -f'
  '^git checkout --( |$)'
  '^gh pr merge( |$)'
)

GATED_ALLOW=(
  '^kill( |$)'
  '^killall( |$)'
  '^git push( |$)'
  '^git rebase -i( |$)'
  '^git add -i( |$)'
)

MATCHED=0
DEFAULT_DECISION=""
DEFAULT_BUTTON=""

for pattern in "${GATED_DENY[@]}"; do
  if [[ "$COMMAND" =~ $pattern ]]; then
    MATCHED=1; DEFAULT_DECISION="deny"; DEFAULT_BUTTON="Deny"; break
  fi
done

if [ "$MATCHED" -eq 0 ]; then
  for pattern in "${GATED_ALLOW[@]}"; do
    if [[ "$COMMAND" =~ $pattern ]]; then
      MATCHED=1; DEFAULT_DECISION="allow"; DEFAULT_BUTTON="Allow"; break
    fi
  done
fi

log "matched: $MATCHED, default: $DEFAULT_DECISION"

# not a gated command -> no opinion
if [ "$MATCHED" -eq 0 ]; then
  exit 0
fi

emit() {  # $1=decision $2=reason
  log "final decision: $1 ($2)"
  jq -n --arg decision "$1" --arg reason "$2" \
    '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: $decision, permissionDecisionReason: $reason } }'
}

# --- no GUI available (non-macOS / no osascript) -> apply lazy default --------
if [ "$(uname)" != "Darwin" ] || ! command -v osascript >/dev/null 2>&1; then
  emit "$DEFAULT_DECISION" "no native dialog available -> lazy default $DEFAULT_DECISION"
  exit 0
fi

# --- dialog -------------------------------------------------------------------
TIMEOUT_SECS=15

# Body text (incl. the Korean command) goes through a UTF-8 file, read by AppleScript
# as «class utf8» so multibyte chars survive. printf preserves the bytes verbatim.
BODY_FILE=$(mktemp "${TMPDIR:-/tmp}/confirm-gate.XXXXXX")
trap 'rm -f "$BODY_FILE"' EXIT
printf '%s' "Auto-${DEFAULT_DECISION} in ${TIMEOUT_SECS} seconds.

Command:
${COMMAND}" > "$BODY_FILE"

log "showing dialog (default: $DEFAULT_DECISION, timeout: ${TIMEOUT_SECS}s)..."

ANS=$(osascript - "$BODY_FILE" "$DEFAULT_BUTTON" "$TIMEOUT_SECS" <<'APPLESCRIPT' 2>>"$LOG"
on run argv
  try
    set bodyPath to item 1 of argv
    set defaultBtn to item 2 of argv
    set timeoutSecs to (item 3 of argv) as integer
    set fh to open for access (POSIX file bodyPath)
    set bodyText to (read fh as «class utf8»)
    close access fh
    set dlg to display dialog bodyText buttons {"Deny", "Allow"} default button defaultBtn with title "Claude Code — Confirm Command" with icon caution giving up after timeoutSecs
    if (gave up of dlg) then
      return "timeout"
    else
      return button returned of dlg
    end if
  on error errMsg number errNum
    try
      close access (POSIX file bodyPath)
    end try
    return "error: " & errNum & " " & errMsg
  end try
end run
APPLESCRIPT
)
log "dialog returned: $ANS"

case "$ANS" in
  Allow)   emit "allow" "user approved via dialog" ;;
  Deny)    emit "deny"  "user denied via dialog" ;;
  timeout) emit "$DEFAULT_DECISION" "dialog timed out (${TIMEOUT_SECS}s) -> lazy default $DEFAULT_DECISION" ;;
  *)       emit "$DEFAULT_DECISION" "dialog error or unknown ($ANS) -> lazy default $DEFAULT_DECISION" ;;
esac
