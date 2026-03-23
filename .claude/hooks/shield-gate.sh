#!/bin/bash
# Hard gate: block PR creation unless /prepush was run for current HEAD.
# Checks the .shield-passed flag — does not run shield itself.

SHIELD_FLAG=".totem/cache/.shield-passed"
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null)
FLAG_CONTENT=$(cat "$SHIELD_FLAG" 2>/dev/null)

# If shield already passed for this exact commit, allow PR creation
if [ "$FLAG_CONTENT" = "$CURRENT_HEAD" ]; then
  exit 0
fi

echo "BLOCKED: totem shield has not passed for HEAD ($CURRENT_HEAD)." >&2
echo "Run /prepush first, then retry PR creation." >&2
exit 2
