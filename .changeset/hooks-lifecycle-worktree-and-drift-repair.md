---
'@mmnto/cli': patch
---

fix(hooks): worktree-safe sync-log path + truthful drift remediation.

- **Worktree ENOTDIR (mmnto-ai/totem#2376):** the generated post-merge / post-checkout hooks resolved their sync log via a hardcoded `.git/totem-sync.log`. In a linked worktree `.git` is a FILE (a `gitdir:` pointer), so that redirect failed with `Not a directory`. The hook scripts now derive the log directory from `git rev-parse --git-dir` at runtime, which is correct in both a normal checkout and a linked worktree.
- **No-op drift remediation (mmnto-ai/totem#2138):** `totem doctor --parity` git-hooks drift rows now name `totem hook install --force`, and bare `totem hook install` drift-repairs a totem-OWNED whole-file hook in place (a user hook with an appended totem block is still left untouched without `--force`).

Consumer-impact: hook templates regenerate-owed for consumers — run `totem hook install --force` after upgrade to pick up the worktree-safe log path.
