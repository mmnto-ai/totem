## Lesson — Always check which directory you're in after working

**Tags:** git, submodule, strategy, working-directory, trap

# Always check which directory you're in after working in the strategy submodule

## What happened
After committing and pushing to `.strategy/` (the git submodule), subsequent commands ran in the submodule directory instead of the main repo root. This caused `git branch` to show strategy branches, `git checkout` to fail finding main repo branches, and branch operations to target the wrong repository.

## Rule
After any operation in `.strategy/`, immediately return to the repo root (`cd "$(git rev-parse --show-toplevel)"`) before running git commands. The submodule is a separate git repo with its own HEAD, branches, and remote. Commands that work in the submodule context will silently produce wrong results in the main repo context.

**Source:** mcp (added at 2026-03-27T22:17:31.282Z)
