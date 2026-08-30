---
'@mmnto/cli': minor
'@mmnto/totem': patch
---

The managed git hooks now render the CONFIGURED `totemDir` (mmnto-ai/totem#2692).

**The break they close.** `totem spec` writes its run artifact under `path.join(configRoot, config.totemDir)/artifacts/runs`, but the strict pre-commit hook's spec-evidence reader was a hardcoded `const dir = ".totem/artifacts/runs"`. Under a custom `totemDir` the writer and the reader named different trees, so the gate blocked forever on the very command it told you to run — the mmnto-ai/totem#2690 shape, re-created. The rest of the family failed the other way, silently: pre-push's `[ -f ".totem/compile-manifest.json" ]` / `[ -f ".totem/compiled-rules.json" ]` guards and post-merge / post-checkout's `grep -q '\.totem/…'` diff filters simply never matched, so the manifest, lint, badge, lockfile and claim-discipline gates were SKIPPED without a word.

**The cure.** One resolver — `resolveHookRenderOptions(cwd, flags?) → { tier, totemDir, fallbackCmd, configPath }` — is the single config→hook-render seam, and every writer of hook text goes through it: `totem hook install`, `totem init`, the non-interactive installer, the hook-manager helper scripts, the silent pre-push upgrade, and `doctor --parity`'s regenerated canonical. The four builders (`buildPreCommitHook`, `buildPrePushHook`, `buildHookContent`, `buildPostCheckoutHookContent`) now take a REQUIRED options object with no defaulted parameter, so the compiler — not a reviewer — catches a forgotten thread. Each site takes the quoting regime it needs: a JSON literal inside the single-quoted `node -e '…'` reader, the plain double-quoted `[ -f ]` / `[ -d ]` words `tools/*` already ships, BRE-escaped `grep` patterns. Because the value is user-supplied, a `totemDir` carrying a quote, a backslash, a dollar sign, a backtick, a newline or a control character is refused loudly — by the installer at render time and by the `@mmnto/totem` config schema's `totemDir` refine.

**Disclosed behaviour changes.**

- `totem init` and the silent pre-push upgrade (`shieldCommand`) now honour `hooks.tier` from config. They did not before: `init` rendered from `--strict` only, and the upgrade path read nothing at all — silently downgrading a strict hook to standard on every `totem review`.
- `totem hook install` resolves config at the GIT ROOT rather than the invocation cwd, so installing from a subdirectory now picks up the repo's config instead of falling through to the global `~/.totem/` profile.
- `doctor`'s always-on `Git Hooks` row gains ONE conditional check — only when `totemDir` is non-default it regenerates the canonical four and compares the totem-owned block between each hook's markers, warning with `totem hook install --force` for a totem-owned hook and, for a user hook carrying an appended totem block, with the delete-and-re-append line instead (`--force` rewrites the whole file). Zero added cost on the default. `doctor --parity`'s `git-hooks` rows get the same totemDir-aware canonical by construction.
- `totem eject` removes the configured Totem directory (and `<totemDir>/hooks/shield-gate.cjs`), not a hardcoded `.totem/`; `totem link` probes the TARGET repo's own configured directory name (its repo-local config, else `.totem`) and writes the globs for it; `doctor`'s stale-rule walk reads the configured directory too.

`totemDir` is read from the REPO-LOCAL config only: the global `~/.totem/` profile declares `totemDir: '.'` to describe itself, and honouring that would re-render every config-less repo's hooks against the checkout root.

**Not a break at the default.** Rendering at `{ tier: 'standard', totemDir: '.totem', fallbackCmd: 'pnpm dlx @mmnto/cli' }` produces `tools/{pre-commit,pre-push,post-merge}` byte-for-byte — `tools/` is unchanged and no consumer's installed hooks drift on upgrade. Minor rather than patch because the rendered output changes for non-default configs and two commands start honouring a config key they ignored.

**After changing `totemDir`, run `totem hook install --force`** — the installed hooks keep reading the previous directory until you do. `doctor` now says so when it happens.
