# @mmnto/pack-agent-workflow

## 2.11.0

### Minor Changes

- 8d96f54: `totem mail send` and `totem mail reply` now guard what they write, on four datums from the cohort (mmnto-ai/totem#2930, mmnto-ai/totem#2929, mmnto-ai/totem#2887, mmnto-ai/totem#2889).
  - **Outbox root (mmnto-ai/totem#2930).** The send resolves its repository root to the repository TOPLEVEL: the nearest ancestor carrying a `.git` directory (a `.git` file, a worktree's or a submodule's pointer, stops the walk and is refused), which must carry a real `.totem/` and must HOST the sending seat (`.totem/orchestration/<seat>/` registered by `totem seat add`). A send from `<repo>/tools/` lands in `<repo>/.totem/orchestration/<seat>/outbox/`, where the poll reads it. Before, the outbox root was the current directory itself, so a send from a subdirectory or from the workspace parent minted a `.totem/orchestration/` tree there, printed `Dispatch written` and exited 0 while no poll would ever list the file. A `.totem/` WITHOUT `.git` (a tool's temp state under `packages/<x>/`, or a phantom outbox the old send left under `apps/<x>/`) is never the root: the nearest-marker walker the reader shares would stop at it, and the falsification leg reproduced a send from `<repo>/packages/cli/src` landing there. **BEHAVIOUR CHANGE:** a start with no `.git` at or above it, a worktree or submodule (a `.git` FILE: never a seat's host, the refusal names the resident checkout its pointer leads to), a git repository with no real `.totem/` directory (absent, or a link — the reader follows none), a resident checkout that has not registered the sending seat, and, when `TOTEM_WORKSPACE` names a workspace, a resident that is not its direct child (a clone elsewhere, a clone nested inside a resident: no poll of that workspace enumerates it) are each refused (exit 1, the line names the directory and the cure) instead of having an outbox minted under them. Disclosed residual: with no workspace named, the resident's parent is its workspace by definition, so a resident-shaped clone outside the cohort workspace is accepted and no poll of the cohort workspace reads it; the pin closes that. The reader-side verbs keep the nearest-marker walker; their stray-marker capture is filed separately.
  - **Empty body (mmnto-ai/totem#2887).** An empty or whitespace-only body, from `--body-file` or the body argument, is refused before anything is written; the line names the source and its byte count. **BEHAVIOUR CHANGE:** a send with no body at all used to write a frontmatter-only dispatch and exit 0; it now exits 1. The listing (`totem mail`) flags a served dispatch whose body is empty with a `warning:` line beside its subject, and `--json` entries carry `bodyEmpty`.
  - **Reply basenames (mmnto-ai/totem#2929).** A reply's derived basename is `<stamp>-<recipient>-<sender>-<re-subject>`: the sender token leads the topic, so N seats replying to one round kit in the same minute never converge on one basename in the recipient's `processed/` store. `mail reply` gains `--slug`, used as given after the recipient-prefix strip and slugification; a blank slug, or one that strips down to nothing, is no slug, and the derived form with the sender token applies. Send basenames are unchanged.
  - **Recipient-prefixed slugs (mmnto-ai/totem#2889).** A `--slug` that begins with the recipient token is stripped of it, with a warning naming what was stripped, instead of doubling the recipient in the filename; both verbs' `--slug` help text now says the slug is appended after `<stamp>-<recipient>-`.
  - **`totem mail verify <path>` (mmnto-ai/totem#2887, ask 3).** Verifies ONE dispatch as written and routable, without listing or reading any other seat's outbox: the frontmatter parses, `to:` is `broadcast` or a roster seat, the body is non-empty, and the file sits at outbox depth 1 of a hosted seat under a resident checkout (a `.git` directory at the root, a real `.totem/` and seat directory with no link in the way, and, when `--workspace` or `TOTEM_WORKSPACE` names a workspace, the repository is its direct child; a stray `.totem/` under a subdirectory, a worktree, a linked tree or a clone outside the named workspace fails placement). The roster is taken from the file's own repository when it is placed, never the shell's cwd, and the findings are reported in that fixed order. A failing check exits 1; `--json` emits the structured result on stdout with the same exit. `send` and `reply` end with the same four checks over the file they wrote and print one `verified:` line. The verb reports written-and-routable, never consumed: consumption is the recipient's mark.

## 2.10.0

### Minor Changes

- 6954f2a: The managed pre-commit and pre-push hooks now recognise a Claude Code shell (mmnto-ai/totem#2706). Their agent-detection block arms the strict tier on `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`, the two variables Claude Code actually exports into every tool shell, beside the previous `CLAUDE_CODE_AGENT`, `CLAUDE_VERSION` and `CURSOR_TRACE_ID`. Five seat-measurements in five checkouts (four named cohort repositories and one consumer) between 2026-08-30 and 2026-09-13 found no live Claude Code session carrying the old two names, so the "AI agents get strict automatically" sentence in the managed CLAUDE.md block described a mechanism that never fired on any Claude Code seat; the sentence now names the variables and the opt-in for other seats, and the reflex block version moves to 16 so `totem init` refreshes it.

  **BEHAVIOUR CHANGE for Claude Code seats, at the next hook re-render** (`totem init`, `totem hook install`, or a consumer's `prepare`): the pre-commit hook blocks a commit until the checkout carries an anchored `totem spec` run artifact, and the pre-push hook runs the three strict arms: the legs gate in blocking mode (a legs-owed push with no fresh deposit is refused), `totem doctor --strict` (the repo-state gate), and the shield gate (`totem review --gate`, the local review lanes with the declared disposition-to-exit mapping). The claim-discipline gate is not one of them; it already ran at every tier. A seat that already runs `totem spec` and the review leg by discipline meets the first two arms with no new step; the other two run on every push from a Claude Code shell regardless, and each can block: `totem doctor --strict` on repo state, and the shield gate, which spends the local review lanes (an LLM call per push, about twenty seconds). A fresh worktree sees one BLOCKED line at commit with the one-command cure. There is no repo-level opt-out, and there never was one for Cursor seats: the arm is `is_agent = 1 OR tier = strict`, so an installed block that reads `TOTEM_HOOK_TIER="standard"` still arms when the shell carries a marker, and a `hooks.tier: 'standard'` pin in `totem.config.ts` does not suppress it (the config schema has said so all along: "Agents are auto-detected and enforced at strict level regardless of this setting"). The per-command overrides are git's own `--no-verify` on `git commit` (the pre-commit header names it) and on `git push`, or running that one command with both marker variables unset: a live Claude Code shell exports both, so unsetting one alone still arms. No exit code, flag or file format changes.

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
