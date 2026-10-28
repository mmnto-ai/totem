## Lesson — spawnSync never throws ENOENT: do not wrap it in try/catch

**Tags:** review-guidance, hooks, spawnSync, error-handling, tenet-4

**Node's `spawnSync` does not throw when the binary is missing.** It returns a result with `status: null` and `error.code === 'ENOENT'` (measured on Node 24: `threw=false`); a missing cwd or a file where a directory is expected reports the same way. The installer's resolvers in `packages/cli/src/commands/install-hooks.ts` (`resolveHooksDir`, `resolveGitDirs`, `isBareFromDirs`, `otherWorktreeRoots`, `anotherWorktreeRunsHooksDir`) read `status !== 0` as the offline fallback or the loud failure, so a `try/catch` around the call guards nothing, and a `process.exitCode = 1` inside such a catch would turn a reachable fallback into a failure.

**Do not suggest wrapping `spawnSync('git', ...)` in `try/catch` for ENOENT.** Declined with that measurement four times on mmnto-ai/totem#3124 across two bot rounds (2026-10-26 and 2026-10-28). An `fs` read that follows a successful probe is a separate question, answered by the module's own Tenet-4 comments (an unreadable `.git` pointer is a broken repository and stays loud), not by a catch. Substrate: `.gemini/styleguide.md` section 6 carries the matching entry.
