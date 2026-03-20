#!/bin/bash
# Warn (don't block) if /prepush hasn't been run before git push.
# The /prepush skill creates .shield-passed after shield passes.
# This hook consumes the flag — every push requires a fresh /prepush.

TOOL_INPUT=$(cat)
COMMAND=$(echo "$TOOL_INPUT" | grep -o '"command":"[^"]*"' | head -1 | sed 's/"command":"//;s/"//')

# Only check git push commands
if echo "$COMMAND" | grep -q "git push"; then
  SHIELD_FLAG=".totem/cache/.shield-passed"

  if [ ! -f "$SHIELD_FLAG" ]; then
    echo "⚠️  Shield hasn't been run. Consider running /prepush first." >&2
    echo "Proceeding anyway..." >&2
    exit 0
  fi

  # Consume the flag — next push requires a fresh /prepush
  rm -f "$SHIELD_FLAG"
fi

exit 0
