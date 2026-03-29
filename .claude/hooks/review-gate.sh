#!/bin/bash
# PreToolUse hook — Content Hash Gate for git push.
# Blocks the AI agent from pushing code that hasn't been reviewed.
# This hook ONLY fires inside Claude Code (PreToolUse boundary).
# Human terminal pushes are unaffected.
#
# Exit 0 = allow, Exit 2 = block.

TOOL_INPUT=$(cat)

# Extract the command
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty')
else
  COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')
fi

# Only gate git push commands
if [[ ! "$COMMAND" =~ (^|[[:space:]])git[[:space:]]+push([[:space:]]|$) ]]; then
  exit 0
fi

# Compute current content hash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_HASH=$(bash "$SCRIPT_DIR/content-hash.sh" 2>/dev/null)

if [ -z "$CURRENT_HASH" ]; then
  # No source files tracked — allow push (nothing to review)
  exit 0
fi

# Read stored hash from last review
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
HASH_FILE="$GIT_ROOT/.totem/cache/.reviewed-content-hash"

if [ ! -f "$HASH_FILE" ]; then
  echo "BLOCKED: No review on record. Run 'totem review' before pushing." >&2
  exit 2
fi

REVIEWED_HASH=$(cat "$HASH_FILE" 2>/dev/null | tr -d '[:space:]')

if [ "$CURRENT_HASH" != "$REVIEWED_HASH" ]; then
  echo "BLOCKED: Source files changed since last review." >&2
  echo "  Reviewed hash: ${REVIEWED_HASH:0:16}..." >&2
  echo "  Current hash:  ${CURRENT_HASH:0:16}..." >&2
  echo "Run 'totem review' to re-validate, then push." >&2
  exit 2
fi

# Content hash matches — the code being pushed is exactly what was reviewed.
exit 0
