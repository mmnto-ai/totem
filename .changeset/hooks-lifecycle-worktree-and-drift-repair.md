---
'@mmnto/cli': patch
---

fix(hooks): worktree-safe sync-log path + truthful drift remediation.

- **Worktree ENOTDIR (mmnto-ai/totem#2376):** the generated post-merge / post-checkout hooks resolved their sync log via a hardcoded `.git/totem-sync.log`. In a linked worktree `.git` is a FILE (a `gitdir:` pointer), so that redirect failed with `Not a directory`. The hook scripts now derive the log directory from `git rev-parse --git-dir` at runtime, which is correct in both a normal checkout and a linked worktree.
- **No-op drift remediation (mmnto-ai/totem#2138):** `totem doctor --parity` git-hooks drift rows now name `totem hook install --force`, and bare `totem hook install` drift-repairs a totem-OWNED whole-file hook in place (a user hook with an appended totem block is still left untouched without `--force`).
- **Appended-content safety for pre-commit / pre-push:** these two templates now emit an end marker (`# [totem] end pre-commit` / `# [totem] end pre-push`) so the totem region is bounded on all four hooks. No-force drift-repair now requires that bounded region, so custom logic appended after the marker is never silently clobbered. A legacy hook from an older (markerless) template declines auto-repair and takes the one `totem hook install --force` already prescribed above.
- **Loud chmod on POSIX:** `writeExecutableHook` no longer swallows chmod failures — a POSIX exec-bit failure now propagates instead of falsely reporting `installed` for a hook git cannot run (Windows still skips the chmod; git-bash owns the exec bit there).
- **Revision-terminated diffs:** the generated post-checkout / post-merge scripts pass `--` to `git diff` / `git diff-tree` so a ref/path ambiguity can never reinterpret a SHA as a pathspec.

Consumer-impact: hook templates regenerate-owed for consumers — run `totem hook install --force` after upgrade to pick up the worktree-safe log path and the bounded pre-commit / pre-push regions.
