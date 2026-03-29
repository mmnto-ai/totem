## Lesson — Testing hook upgrades by checking only for a marker

**Tags:** testing, git-hooks

Testing hook upgrades by checking only for a marker can leave stale shell fragments undetected. Assert the full normalized file content to ensure the replacement logic is clean and does not leave orphaned code.
