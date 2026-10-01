---
'@mmnto/cli': patch
---

The prefer-local re-exec now reports how current a workspace build is (mmnto-ai/totem#2934). When the entrypoint finds a workspace build (a checkout that carries `packages/cli` named `@mmnto/cli`, which is this repository), the delegation banner names the instant the delegated `dist` was built, as ` (built <ISO>)` after the version. When a source file under `packages/cli/src` or `packages/core/src` is newer than that package's `dist/index.js`, one more stderr line names the lagging package, both instants and `pnpm build`. The CLI still delegates to the stale build: the line is a sensor, and argv, environment and exit code are unchanged.

Running the workspace build directly (`node packages/cli/dist/index.js <verb>`) never delegates and prints no banner. In that case a stale build prints one line, `[totem] This workspace build is STALE: ...`, and the command runs in place.

The pinned tier that consumers use (`node_modules/@mmnto/cli`) is unchanged byte for byte, and no mtime is read there. `TOTEM_NO_REEXEC=1` still turns the whole re-exec off, this line included. If the source tree cannot be read, the banner drops the build instant and prints no stale line. `TOTEM_DEBUG=1` rethrows that error.
