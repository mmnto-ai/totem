---
'@mmnto/cli': patch
---

`totem eject` no longer silently no-ops on git hooks in a linked worktree, and now anchors hook removal at the git root when run from a subdirectory (mmnto-ai/totem#2426, sibling of #2422). The hook scrubber previously joined `<cwd>/.git/hooks/<name>` blind — but in a linked worktree `.git` is a `gitdir:` pointer FILE and the hooks git actually runs live in the shared common dir, so every hook reported "not found" and eject removed nothing. Eject now resolves the hooks directory through the SAME helpers `hook install` uses (`resolveGitRootForHookPath` + `resolveHooksDir`, git's own worktree/`commondir`/`core.hooksPath` walk).

Because the resolved hooks directory is SHARED across every worktree of a repo, eject run from a linked worktree now **declines** to remove the git hooks (removing them would change hook behavior for the main checkout and every sibling worktree) and prints a line naming the shared location, directing you to run `totem eject` from the main working tree. All other eject cleanup (scaffolded files, settings entries, reflex blocks, `.totem/`, config) is per-working-tree and still runs from a worktree. Whether an eject from a worktree should instead scrub the shared hooks (symmetric with `hook install`) is left as an open policy question for a follow-up.
