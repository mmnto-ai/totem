## Lesson — A repair hint names the directory where the command works

**Tags:** cli, monorepo, re-exec, dx
**Scope:** packages/cli/src/reexec-local.ts

`pnpm build --force` forces the turbo build only from the workspace root. Inside a package directory the same words run that package's own build script, plain `tsc`, which refuses the flag: exit 1, `error TS5093: Compiler option '--force' may only be used with '--build'`, dist untouched (measured from `packages/cli`). A hint printed to someone whose cwd is unknown must carry the place: the stale-build line says "from the workspace root" and prints the root the probe resolved from the delegated entry, never the cwd (mmnto-ai/totem#2998, a bot finding verified by measurement).
