#!/bin/bash
# Block git push if /prepush hasn't been run.
# The /prepush skill creates .shield-passed after shield passes.
# This hook consumes the flag — every push requires a fresh /prepush.

TOOL_INPUT=$(cat)
COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')

# Only check git push commands
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
