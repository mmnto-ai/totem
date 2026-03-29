#!/bin/bash
# Phase-gate enforcement (ADR-063):
# 1. Block git commit if /preflight hasn't been run on a feature branch
# 2. Block gh pr create if /prepush hasn't been run

TOOL_INPUT=$(cat)
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

if command -v jq &>/dev/null; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty')
else
  COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')
fi

# ─── Gate 1: Spec before commit (hard block) ──
if [[ "$COMMAND" =~ (^|[[:space:]])git[[:space:]]+commit([[:space:]]|$) ]]; then
  SPEC_FLAG="$GIT_ROOT/.totem/cache/.spec-completed"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  # Skip: main/master, hotfix/docs branches, detached HEAD
  case "$BRANCH" in
    main|master|HEAD|hotfix/*|docs/*) ;;
    *)
      if [ ! -f "$SPEC_FLAG" ] || [ ! -s "$SPEC_FLAG" ]; then
        echo "BLOCKED: /preflight has not been run on branch '$BRANCH'. Run /preflight <issue> first." >&2
        exit 2
      fi
      # Extract ticket number from branch name (first numeric sequence)
      BRANCH_TICKET=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)
      FLAG_TICKET=$(cat "$SPEC_FLAG" 2>/dev/null | tr -d '[:space:]')
      # If branch has a ticket number, verify it matches the flag
      if [ -n "$BRANCH_TICKET" ] && [ -n "$FLAG_TICKET" ] && [ "$BRANCH_TICKET" != "$FLAG_TICKET" ]; then
        echo "BLOCKED: Stale spec flag — preflight was run for #$FLAG_TICKET but branch is '$BRANCH' (#$BRANCH_TICKET)." >&2
        echo "Run /preflight $BRANCH_TICKET to re-generate the spec." >&2
        exit 2
      fi
      ;;
  esac
fi

# ─── Gate 2: Shield before PR creation via gh CLI (hard block) ──
if [[ "$COMMAND" == *"gh pr create"* ]]; then
  SHIELD_FLAG="$GIT_ROOT/.totem/cache/.shield-passed"
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
  FLAG_CONTENT=$(cat "$SHIELD_FLAG" 2>/dev/null)
  if [ -z "$FLAG_CONTENT" ]; then
    echo "BLOCKED: totem review has not passed. Run /prepush first." >&2
    exit 2
  fi
  if [ "$FLAG_CONTENT" != "$CURRENT_HEAD" ]; then
    # Ancestry check: shield may still be valid if only non-target files changed
    if git merge-base --is-ancestor "$FLAG_CONTENT" "$CURRENT_HEAD" 2>/dev/null; then
      TARGET_GLOBS_FILE="$GIT_ROOT/.totem/cache/.target-globs"
      if [ -f "$TARGET_GLOBS_FILE" ]; then
        TARGET_GLOBS=$(cat "$TARGET_GLOBS_FILE" 2>/dev/null | tr '\n' ' ')
      fi
      if [ -z "$TARGET_GLOBS" ]; then
        TARGET_GLOBS="*.ts *.tsx *.js *.jsx"
      fi
      # shellcheck disable=SC2086
      set -f  # disable globbing so *.ts is passed as pathspec, not expanded
      SRC_CHANGES=$(git diff --name-only "$FLAG_CONTENT" "$CURRENT_HEAD" -- $TARGET_GLOBS 2>/dev/null)
      set +f
      if [ -n "$SRC_CHANGES" ]; then
        echo "BLOCKED: source files changed since totem review passed." >&2
        echo "Changed files:" >&2
        echo "$SRC_CHANGES" | while read -r f; do echo "  $f" >&2; done
        echo "Run /prepush to re-validate." >&2
        exit 2
      fi
      # Non-target changes only — shield still valid
    else
      echo "BLOCKED: totem review passed for a non-ancestor commit (rebase?)." >&2
      echo "  review SHA: $FLAG_CONTENT" >&2
      echo "  HEAD SHA:   $CURRENT_HEAD" >&2
      echo "Run /prepush to re-validate." >&2
      exit 2
    fi
  fi
fi

exit 0
