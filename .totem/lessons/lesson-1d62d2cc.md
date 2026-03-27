## Lesson — Shield flag becomes stale after every commit — refresh

**Tags:** shield, pre-push, workflow, git-hooks, trap

# Shield flag becomes stale after every commit — refresh before push

## What happened
The pre-push hook checks that `.totem/cache/.shield-passed` contains the current HEAD SHA. Every `git commit` changes HEAD, making the flag stale. This caused repeated "Shield flag is stale" blocks during the PR workflow — especially painful when amending commits.

## Rule
Always run `git rev-parse HEAD > .totem/cache/.shield-passed` AFTER the commit, not before. The sequence is:
1. Run shield (or verify changes are trivial)
2. `git commit`
3. `git rev-parse HEAD > .totem/cache/.shield-passed`
4. `git push`

Steps 2-3 must be adjacent — any commit between shield and push invalidates the flag.

**Source:** mcp (added at 2026-03-27T19:55:55.260Z)
