## Lesson — a path-filtered push workflow in a repository that cuts

**Tags:** github-actions, ci-cd, tag-push, path-filter, release, trap

**Applies-to:** infrastructure

GitHub does not evaluate `paths` or `paths-ignore` filters for tag pushes, so an `on: push` workflow whose only narrowing is a `paths` filter runs on EVERY tag push, against whatever the tree is at the tag. On totem the spine-adopt spike workflow (`.github/workflows/spine-spike-linux.yml`, `paths: spikes/spine-adopt/**`) ran both matrix legs on each release cut's five tag pushes (the four package tags and the floating `v0`): fifteen red runs across the 2.16.1, 2.16.2 and 2.16.3 cuts, none a regression in the spike, all against a live corpus the spike had never pinned, so the reds looked like the spike's and were the trigger's. Cure (mmnto-ai/totem#3095): name `branches: ['**']` under `on.push`; a push trigger that lists branches never fires for a tag, and the `paths` filter governs the branch pushes exactly as before. Rule: a path-filtered push workflow in a repository that cuts tags names its branches explicitly, or it runs on every tag and its reds land on the release.

**Source:** mcp (added at 2026-10-16T04:59:14.743Z)
