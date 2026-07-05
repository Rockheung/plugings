#!/bin/sh
# claude-clock — active wall-clock probe.
# Claude has no passive time sensor; this lets it *query* elapsed time
# instead of pretending to feel it. State is a tiny epoch file per label.
set -eu
dir="${CLAUDE_CLOCK_DIR:-${TMPDIR:-/tmp}/claude-clock}"
mkdir -p "$dir"
cmd="${1:-}"; label="${2:-default}"
case "$cmd" in
  start)
    date +%s > "$dir/$label"
    echo "started '$label' @ $(date '+%H:%M:%S')"
    ;;
  elapsed)
    f="$dir/$label"
    [ -f "$f" ] || { echo "no start for '$label'" >&2; exit 1; }
    echo $(( $(date +%s) - $(cat "$f") ))
    ;;
  *)
    echo "usage: clock.sh start|elapsed [label]" >&2
    exit 2
    ;;
esac
