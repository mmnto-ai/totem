#!/bin/bash
# Phase-gate enforcement (ADR-063):
# 1. Block git commit if /preflight hasn't been run on a feature branch
# 2. Block git push if /prepush hasn't been run

TOOL_INPUT=$(cat)
COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')

# ─── Gate 1: Spec before commit (hard block) ──
if [[ "$COMMAND" == *"commit"* && "$COMMAND" == *"git"* ]]; then
  SPEC_FLAG=".totem/cache/.spec-completed"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  # Skip: main/master, hotfix/docs branches, detached HEAD
  case "$BRANCH" in
    main|master|HEAD|hotfix/*|docs/*) ;;
    *)
      if [ ! -f "$SPEC_FLAG" ]; then
        echo "BLOCKED: /preflight has not been run on branch '$BRANCH'. Run /preflight <issue> first." >&2
        echo "This gate enforces ADR-063: totem spec must generate an execution plan before any code is written." >&2
        exit 2
      fi
      ;;
  esac
fi

# ─── Gate 2: Shield before push (hard block) ──
if [[ "$COMMAND" == *"push"* && "$COMMAND" == *"git"* ]]; then
  SHIELD_FLAG=".totem/cache/.shield-passed"

  if [ ! -f "$SHIELD_FLAG" ]; then
    echo "BLOCKED: Run /prepush before pushing." >&2
    exit 2
  fi

  # Verify flag is fresh — must match current HEAD
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
  FLAG_CONTENT=$(cat "$SHIELD_FLAG" 2>/dev/null)
  if [ "$FLAG_CONTENT" != "$CURRENT_HEAD" ]; then
    echo "BLOCKED: Shield flag is stale (from a different commit). Run /prepush again." >&2
    exit 2
  fi

  # Consume the flag — next push requires a fresh /prepush
  rm -f "$SHIELD_FLAG"
fi

# ─── Gate 3: Shield before PR creation via gh CLI (hard block) ──
if [[ "$COMMAND" == *"gh pr create"* ]]; then
  SHIELD_FLAG=".totem/cache/.shield-passed"
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
  FLAG_CONTENT=$(cat "$SHIELD_FLAG" 2>/dev/null)
  if [ "$FLAG_CONTENT" != "$CURRENT_HEAD" ]; then
    echo "BLOCKED: totem shield has not passed for HEAD ($CURRENT_HEAD). Run /prepush first." >&2
    exit 2
  fi
fi

exit 0
