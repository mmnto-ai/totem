---
'@mmnto/cli': patch
---

`totem hook install` (and the `.totem/prepare.cjs` consumer wrapper that invokes it) no longer crashes with ENOTDIR in a linked git worktree (mmnto-ai/totem#2418). In a worktree `.git` is a `gitdir:` pointer FILE, and every hooks-path site blindly joined `.git/hooks` before `mkdir` — failing the consumer's whole `pnpm install` through the `prepare` lifecycle. A shared `resolveHooksDir()` now delegates to `git rev-parse --git-path hooks` (git's own worktree/`commondir` walk, which also honors `core.hooksPath`), so hooks install into the shared hooks directory git actually executes; `--check`, the silent pre-push upgrade, and the doctor `git-hooks` parity row read the same resolved location instead of wrongly reporting hooks missing from a worktree. An unparseable `.git` pointer file is now the declared skip the #2410 exit-code contract names (exit 0 with a truthful skip line), never a crash.
