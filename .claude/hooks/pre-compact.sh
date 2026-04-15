#!/usr/bin/env bash
# PreCompact hook — mechanical session-state breadcrumb written before
# Claude Code auto-compaction. Preserves branch, HEAD, git status, and
# recent commits to a timestamped artifact under .totem/cache/.
#
# Exit contract (invariant): 0 on success, 1 on any failure. Never 2.
# Compaction MUST proceed even when this hook fails; a missing breadcrumb
# is strictly better than a stuck compaction cycle.
#
# No network calls. No LLM calls. No cross-file writes beyond the artifact.

set -u

# Coerce any non-zero exit (including bash's default exit 2 on runtime
# misuse) to exit 1. Parse-time syntax errors exit 2 before this trap is
# installed; those are caught by the `bash -n` check in the test suite.
trap 'rc=$?; [ "$rc" -ne 0 ] && exit 1; exit 0' EXIT

# Detect a timeout binary for hang protection. GNU coreutils (Linux,
# Git Bash on Windows) exposes `timeout`; macOS with coreutils installed
# exposes `gtimeout`. Base macOS has neither, and this hook degrades to
# no-timeout — acceptable because git read-only calls on a local repo
# typically return in milliseconds.
TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 2s"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 2s"
fi

run_git() {
  if [ -n "$TIMEOUT_CMD" ]; then
    $TIMEOUT_CMD git "$@"
  else
    git "$@"
  fi
}

# Resolve repo root from the script's own location. Fall back to PWD if
# git cannot determine a toplevel (not a git repo, or git missing).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GIT_ROOT=$(run_git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -z "$GIT_ROOT" ]; then
  GIT_ROOT="$PWD"
fi

CACHE_DIR="$GIT_ROOT/.totem/cache"
mkdir -p "$CACHE_DIR" 2>/dev/null

if [ ! -d "$CACHE_DIR" ]; then
  echo "pre-compact: .totem/cache/ is not writable; skipping signoff" >&2
  exit 1
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
# Include the PID so two compactions within the same second cannot
# collide on the artifact filename.
ARTIFACT="$CACHE_DIR/.pre-compact-signoff-$TIMESTAMP-$$.md"

BRANCH=$(run_git -C "$GIT_ROOT" branch --show-current 2>/dev/null || echo "unknown")
HEAD_SHA=$(run_git -C "$GIT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
STATUS=$(run_git -C "$GIT_ROOT" status --short 2>/dev/null || echo "(git status unavailable)")
RECENT=$(run_git -C "$GIT_ROOT" log --oneline -5 2>/dev/null || echo "(git log unavailable)")

{
  echo "# Pre-compact signoff $TIMESTAMP"
  echo ""
  if [ -n "${SESSION_TITLE:-}" ]; then
    echo "**Session title:** $SESSION_TITLE"
    echo ""
  fi
  echo "**Branch:** $BRANCH"
  echo "**HEAD:** $HEAD_SHA"
  echo ""
  echo "## git status --short"
  echo ""
  echo '```'
  if [ -n "$STATUS" ]; then
    echo "$STATUS"
  else
    echo "(clean)"
  fi
  echo '```'
  echo ""
  echo "## Last 5 commits"
  echo ""
  echo '```'
  echo "$RECENT"
  echo '```'
} >"$ARTIFACT" 2>/dev/null

if [ ! -s "$ARTIFACT" ]; then
  echo "pre-compact: failed to write $ARTIFACT" >&2
  exit 1
fi

exit 0
