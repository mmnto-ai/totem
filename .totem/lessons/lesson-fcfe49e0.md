## Lesson — A cached turbo build does not re-stamp dist

**Tags:** build, turbo, caching, re-exec
**Scope:** packages/cli/src/reexec-local.ts

On a turbo cache hit with `dist` already on disk, `dist/index.js` keeps its old modification time. So "after any build, dist is newer than every source file" is false, and a plain `pnpm build` cannot clear an mtime-based stale line. The design and the changeset first assumed it could, and a falsification read reproduced the miss. The line therefore says "may be stale", names `pnpm build --force`, and says why. The premise had been measured in one state only, a fresh worktree where the cache replay writes dist anew: measure the state the claim is about (mmnto-ai/totem#2998; a content-accurate stamp is tracked on mmnto-ai/totem#2997).
