---
'@mmnto/totem': patch
---

Replace `execFileSync` with `cross-spawn.sync` in `safeExec` to close the Windows shell-injection vector (#1329)

`safeExec` previously set `shell: IS_WIN` on its `execFileSync` call so that Windows `.cmd` and `.bat` shims (`git.cmd`, `npx.cmd`, etc.) could resolve without ENOENT errors. The side effect was that `cmd.exe` interpreted shell metacharacters (`&`, `|`, `>`, `"`, and so on) in argument values, creating both a correctness bug (see mmnto/totem#1233 for the stray `{}` file that appeared when `cmd.exe` parsed the arrow-function `=>` as `=` plus `>`) and a shell-injection surface for any caller that forwarded untrusted input through `safeExec`. 57 call sites across 16 files were at risk.

The fix swaps the underlying primitive from Node's native `child_process.execFileSync` to `cross-spawn.sync`. `cross-spawn` handles Windows `.cmd` and `.bat` shim resolution internally without ever enabling `shell: true` at the Node layer, so shim resolution still works while shell metacharacters in argument values now pass through verbatim on all platforms. The public `safeExec(command, args, options): string` signature is unchanged, the throw-on-non-zero-exit contract is preserved, the `.cause` chain is preserved, and the existing `maxBuffer`, `timeout`, `trim`, and `stdin input` options behave identically.

One additive extension to the error shape: the thrown Error on any failure path now exposes optional `.status`, `.signal`, `.stdout`, and `.stderr` fields matching the richer `SpawnSyncReturns` shape that `cross-spawn` provides. The `.stdout` and `.stderr` fields preserve raw subprocess output (trailing whitespace included) so callers see the unmodified bytes. Message formatting uses trimmed copies internally. Callers that only read `.message` and `.cause` (the pre-#1329 contract) continue to work unchanged. Callers that want to distinguish exit codes no longer have to parse the message body. A new test `exposes .status on the thrown error for non-zero exit codes` locks this in, and the `SafeExecErrorFields` interface is exported from `@mmnto/totem` so downstream packages can type-narrow without falling back to `any`.

Test invariants locked in (3 new, all invariants from the #1329 design doc):

1. Shell metacharacters in argument values pass through verbatim on all platforms (headline regression test, uses `hello&world>bar` as the canonical dangerous argument).
2. Pipes and double quotes in argument values pass through verbatim (second metacharacter set covering `|` and `"`).
3. Non-zero exit codes are exposed on the thrown Error via `.status`.

Existing invariants (all 7 from the design doc) continue to pass after the refactor: throw-on-non-zero-exit, `.cause` chain, throw-on-command-not-found, timeout kill plus throw, trim default and override, and Windows `.cmd` shim resolution (indirectly verified via the existing `node` command resolution tests, which work via the same cross-spawn path).
