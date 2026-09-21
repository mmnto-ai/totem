# @mmnto/pack-agent-workflow

## 2.9.3

### Patch Changes

- caa425d: `totem mail`'s human listing names where to read each unread dispatch (mmnto-ai/totem#2919): every item now carries a third line, `read: <absolute path>`, the same `filePath` the `--json` output emits, under both the directed listing and the identity-gated broadcast listing. Before this a reader saw only the basename and had to know the sender's outbox layout; one consumer improvised with a directory listing of the sender's outbox and saw other seats' dispatches from the same round during a BLIND window. The empty-inbox lines, the `--json` shape and the exit codes are unchanged; the `mail` help text names the new line. A test locks the line's position under each item and its identity with the `--json` path.

## 2.9.2

### Patch Changes

- db20fde: The exports maps of `@mmnto/cli`, `@mmnto/totem` and `@mmnto/mcp` expose the `./package.json` subpath, so `require('@mmnto/cli/package.json').version` and `import.meta.resolve('@mmnto/totem/package.json')` resolve instead of throwing ERR_PACKAGE_PATH_NOT_EXPORTED (mmnto-ai/totem#2917). Additive: every existing subpath and condition is unchanged, and `@mmnto/pack-rust-architecture` already carried the key. A workspace lock in core asserts the key on every published package's source manifest and resolves it through Node's own resolver, red on the previous maps; the packed-tarball arm covers `@mmnto/totem`, and `npm pack --dry-run` shows `package.json` in all three tarballs. Consumers that read the installed version by walking `node_modules` by path can use the package specifier from this version.

## 2.9.1

### Patch Changes

- e4f35b4: ci(tests): `hookTimeout` rides the same platform floor as `testTimeout` in every workspace vitest config (30 s on win32, 15 s elsewhere; it sat at vitest's separate 10 s default), and the `scripts/sync-labels.ps1` dry-run suite carries a 60 s per-row budget for its cold `pwsh` spawn on a loaded runner (mmnto-ai/totem#2896: four CI timeouts in files the failing PRs did not touch — three timeouts across two distinct rows at the 15 s test limit on macOS, one `beforeEach` at the 10 s hook limit on Windows). Test configuration only; no runtime behavior changes.

## 2.9.0

## 2.8.0

## 2.7.0

## 2.6.0

## 2.5.0

## 2.4.0

## 2.3.0

## 2.2.1

## 2.2.0

## 2.1.0

## 2.0.0

## 1.124.0

## 1.123.0

## 1.122.0

## 1.121.0

## 1.120.0

## 1.119.0

## 1.118.1

## 1.118.0

## 1.117.0

## 1.116.0

## 1.115.0

## 1.114.0

## 1.113.1

## 1.113.0

## 1.112.0

## 1.111.1

## 1.111.0

## 1.110.0

## 1.109.0

## 1.108.0

## 1.107.1

## 1.107.0

## 1.106.0
