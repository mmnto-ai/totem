#!/bin/bash
# Phase-gate enforcement (ADR-063):
# 1. Block git push if /prepush hasn't been run
# 2. Warn on git commit if /preflight hasn't been run on a feature branch

TOOL_INPUT=$(cat)
COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')

# ─── Gate 1: Spec before commit (warning) ──
if echo "$COMMAND" | grep -q "git commit"; then
  SPEC_FLAG=".totem/cache/.spec-completed"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  # Skip: main/master, hotfix/docs/chore branches, detached HEAD
  case "$BRANCH" in
    main|master|HEAD|"") ;;
    hotfix/*|docs/*|chore/*|fix/*) ;;
    *)
      if [ ! -f "$SPEC_FLAG" ]; then
        echo "⚠️  No /preflight run on this branch. Consider running /preflight <issue> first." >&2
      fi
      ;;
  esac
fi

# ─── Gate 2: Shield before push (hard block) ──
if echo "$COMMAND" | grep -q "git push"; then
  SHIELD_FLAG=".totem/cache/.shield-passed"

  if [ ! -f "$SHIELD_FLAG" ]; then
    echo "BLOCKED: Run /prepush before pushing." >&2
    exit 2
  fi

  # Consume the flag — next push requires a fresh /prepush
  rm -f "$SHIELD_FLAG"
fi

exit 0
