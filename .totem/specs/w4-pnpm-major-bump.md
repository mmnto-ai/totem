# W4 — pnpm 9.15.4 → 11.2.2 cohort major bump

**Spec type:** preflight (no GitHub issue; wave-plan item, internal tracking)
**Source:** W4 of the cohort dep-refresh wave plan (memory FIRST MOVE block, claude-0067+)
**Drafted:** 2026-05-23 (claude-0069)
**Author:** totem-claude

This document was authored manually (not via `totem spec <N>`) because W4 has no GitHub issue. Phase 1 context-gathering was done via npm view + pnpm release notes + grep against the workspace.

## Phase 1 summary

### What changed in pnpm v9 → v10 → v11

Selected from upstream release notes — **only items that touch our workspace**:

**v10:**

1. **Lifecycle scripts of dependencies are NOT executed by default.** Need `pnpm.onlyBuiltDependencies: ["pkg-a", "pkg-b", ...]` in root `package.json` listing any dep that legitimately needs postinstall.
2. **`manage-package-manager-versions` enabled by default** — pnpm reads the `packageManager` field and self-updates. Bumping `pnpm@9.15.4` → `pnpm@11.2.2` auto-switches everyone on pnpm 10+.
3. Store version → v10 (local cache refresh on first install).
4. Fewer `npm_package_*` env vars during script execution — only `name`, `version`, `bin`, `engines`, `config`.

**v11:**

1. **Node 22+ required.** We're at Node 24 (W3 floor), so no-op.
2. **Supply-chain protection ON by default:** `minimumReleaseAge: 1 day` (newly-published packages aren't resolved for 24h) and `blockExoticSubdeps: true`. **Load-bearing for cohort CI** — when we publish `@mmnto/cli@X.Y.Z` and then immediately run CI against a downstream that depends on it, install would fail.
3. **`allowBuilds` replaces `onlyBuiltDependencies`** (and `neverBuiltDependencies`, `ignoredBuiltDependencies`, `ignoreDepScripts`, `onlyBuiltDependenciesFile`). Config field rename mid-flight.
4. **`.npmrc` is auth/registry ONLY.** All other settings must live in `pnpm-workspace.yaml` or new global `config.yaml`. Our `.npmrc` has `engine-strict=true` which is NOT auth/registry — **migrate to `pnpm-workspace.yaml`**.
5. Native publish flow — `pnpm publish` no longer delegates to npm. Not load-bearing because `tools/publish-oidc.mjs` already uses `pnpm pack` + `npm publish` (the split exists for OIDC).
6. New SQLite-backed store (v11). Local cache concern only.
7. ESM pnpm. Runtime concern only.

### Files in scope (verified via grep)

| File                                                                                                  | Change                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                                                                                 | `packageManager: pnpm@9.15.4 → pnpm@11.2.2`; add `pnpm.onlyBuiltDependencies` (v10 form) OR `pnpm.allowBuilds` (v11 form)                     |
| `pnpm-lock.yaml`                                                                                      | Regenerate (`lockfileVersion: '9.0'` is current; v11 may bump format)                                                                         |
| `.npmrc`                                                                                              | Remove `engine-strict=true` (now must live elsewhere in v11)                                                                                  |
| `pnpm-workspace.yaml`                                                                                 | Add `engine-strict: true` (or v11 equivalent — verify exact key during impl)                                                                  |
| `.github/workflows/{ci,ci-integration,compile-manifest,totem-doctor,lint,release,release-binary}.yml` | All use `pnpm/action-setup@v5` (7 workflows); pin to latest action version + verify `version:` input is set or inferred from `packageManager` |
| `tools/publish-oidc.mjs`                                                                              | Audit only — uses `pnpm pack` + `npm publish`; verify no v10/v11 regression on the pack step                                                  |

**Anti-scope (not modified):** any cohort package's `package.json` except the root; orchestrator code; pack scripts. The bump should be transparent to per-package code.

### Knowledge / lesson signals

- `lesson_preserve_cohort_versions` — cohort-coherence discipline (not directly applicable; W4 doesn't rename packages)
- `feedback_contract_claims_must_anchor_to_canonical_code` — the W3 N+1 anchor lesson: every claim in changeset prose must grep against actual config. Lock-step on W4.
- `feedback_oidc_publish_workflow_pattern` — publish path; the `pnpm pack` + `npm publish` split is durable across v10/v11.
- ADR-101 cohort comparison strictness — out of W4 scope but informative.

### Empirical baseline (verified during Phase 1)

- Current `packageManager`: `pnpm@9.15.4` (root `package.json:4`)
- Current `.npmrc`: `engine-strict=true` (1 line)
- Current `pnpm-workspace.yaml`: `packages: ['packages/*']` (no other settings)
- Lockfile version: `'9.0'`
- All 7 CI workflows use `pnpm/action-setup@v5`
- Active local pnpm: 9.15.4 (matches the pin)
- No existing `pnpm.onlyBuiltDependencies` / `neverBuiltDependencies` / `ignoredBuiltDependencies` config anywhere (grep confirmed)
- Build-script deps that we install:
  - `esbuild` (downloads platform binary at postinstall)
  - `apache-arrow` / `lancedb` (native bindings; transitive)
  - `node-gyp` (if any deps trigger native compilation; likely not for our deps but needs `pnpm install` dry-run to confirm)
  - (full enumeration deferred to implementation — `pnpm install` under v10 will emit a list of skipped lifecycle scripts that becomes the allowlist)

---

## Implementation Design (W4)

### Scope (2 sentences)

Bump `packageManager` from `pnpm@9.15.4` to `pnpm@11.2.2` across the workspace, with the minimum config additions/migrations needed to keep `pnpm install` + CI + `tools/publish-oidc.mjs` working: `pnpm.onlyBuiltDependencies` (or `pnpm.allowBuilds` in v11 form) listing the deps that legitimately need postinstall, migration of `engine-strict=true` from `.npmrc` to `pnpm-workspace.yaml` per v11's auth/registry-only constraint, and a deliberate override of v11's `minimumReleaseAge` default so cohort CI doesn't block on freshly-published `@mmnto/*` packages. This explicitly does NOT bump per-package code, does NOT change the OIDC publish path beyond what v10/v11 force, and does NOT opt into any v11 features beyond what's required to unblock install.

### Data model deltas

1. **`packageManager` field (root `package.json`)** — existing field, value changes.
   - **Was:** `"pnpm@9.15.4"`
   - **Will be:** `"pnpm@11.2.2"` (with `corepack` hash if upstream uses one; verify during impl)
   - **Who writes:** human (this PR)
   - **Who reads:** corepack at every shell init; pnpm v10+ at every install (`manage-package-manager-versions` default)
   - **Invariant:** must match the `pnpm/action-setup@v5` version-input in CI workflows (or be inferred from this field by leaving `version:` unset — preferred per pnpm's own recommendation post-v10)

2. **`pnpm.onlyBuiltDependencies` / `pnpm.allowBuilds` (root `package.json`)** — NEW field.
   - **Holds:** explicit allowlist of dep names whose postinstall scripts are permitted to run
   - **Who writes:** human (this PR + maintainers when adding new deps with native bindings)
   - **Who reads:** pnpm at install time
   - **Invariant:** must include every transitive dep that needs postinstall to function (incomplete list = silent runtime failure when missing binary blobs)
   - **Form ambiguity:** v10 uses `pnpm.onlyBuiltDependencies: [...]`; v11 uses `pnpm.allowBuilds: [...]`. Going direct to v11 means using the v11 form; the v10 form may or may not still be supported under v11 (open question).

3. **`pnpm-workspace.yaml` settings block** — extended.
   - **Was:** `packages: ['packages/*']` (only)
   - **Will be:** add `engineStrict: true` (v11 equivalent of `.npmrc engine-strict=true`; verify exact key name during impl — pnpm-workspace.yaml uses camelCase by convention)
   - **Optionally:** `minimumReleaseAge: 0` (override v11 default of 1 day to keep cohort CI working when consuming freshly-published `@mmnto/*` packages). See open question 3.
   - **Who writes:** human (this PR)
   - **Who reads:** pnpm at install/resolve time
   - **Invariant:** every setting that left `.npmrc` per v11's auth/registry-only constraint must land here (or in global config.yaml — but workspace-level is the right altitude for cohort-shared settings)

4. **`.npmrc`** — narrowed.
   - **Was:** `engine-strict=true`
   - **Will be:** empty (or removed entirely; verify whether totem expects the file to exist as a marker)
   - **Risk:** during the transition window, both old (`.npmrc engine-strict=true`) and new (`pnpm-workspace.yaml engineStrict: true`) could coexist as a safety belt-and-suspenders. Likely don't need to — pnpm v11 ignores non-auth `.npmrc` keys silently or with warning; verify behavior.

5. **CI workflow `pnpm/action-setup` blocks** — 7 files.
   - **Was:** `- uses: pnpm/action-setup@v5` (no explicit version; inferred from `packageManager`)
   - **Will be:** same shape (`pnpm/action-setup@v5` infers from `packageManager`), OR explicit `with: { version: 11.2.2 }` if we want belt-and-suspenders. pnpm's own docs recommend NOT setting `version:` once `manage-package-manager-versions` is in effect, since the inference is the single source of truth.
   - **Invariant:** every workflow that runs `pnpm install` must resolve the same pnpm major as the local dev workflow

### State lifecycle

- **`packageManager` field**: persistent; mutated only at major bumps; read at every shell init that uses corepack
- **`pnpm.onlyBuiltDependencies` / `allowBuilds`**: persistent; appended-to whenever a new dep with native bindings is added; never auto-pruned
- **`pnpm-workspace.yaml` settings**: persistent; mutated at major bumps + when new workspace-shared settings land

No ephemeral state; no cross-lifecycle hazards.

### Failure modes

| Failure                                                                                                                        | Category  | Agent-facing surface                                                                                                                              | Recovery                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` hangs/fails on Windows because corepack didn't pull the new pin                                                 | init      | `ERR_PNPM_UNSUPPORTED_PACKAGE_MANAGER` or corepack network error                                                                                  | User runs `corepack prepare pnpm@11.2.2 --activate` manually                                                                              |
| Build-script dep (esbuild / lancedb) missing from `onlyBuiltDependencies` allowlist                                            | runtime   | silent — `esbuild`'s binary doesn't get downloaded; `pnpm exec esbuild` fails with `EBADF` or "binary not found" at first invocation post-install | Append the dep to the allowlist, re-run `pnpm install`, verify postinstall fires                                                          |
| CI install fails because freshly-published `@mmnto/cli@X.Y.Z` is younger than `minimumReleaseAge: 1 day` (v11 default)         | runtime   | hard error in CI: `ERR_PNPM_PACKAGE_TOO_FRESH` or similar                                                                                         | Override via `minimumReleaseAge: 0` in `pnpm-workspace.yaml` (see open question 3), OR wait 24h, OR add a per-package override            |
| `.npmrc engine-strict=true` silently dropped by v11 (ignored as non-auth setting); engines.node mismatches no longer fail-loud | permanent | silent degradation — drift introduced by v11 ignores the setting, install succeeds on wrong Node                                                  | Verify migration to `pnpm-workspace.yaml` is complete and `engineStrict: true` is honored at install time (manual test with wrong Node)   |
| `pnpm/action-setup@v5` doesn't support pnpm v11 yet (action-setup version mismatch)                                            | init      | CI hard error: action setup step fails before any pnpm command runs                                                                               | Bump action-setup to a version that supports v11 (check `pnpm/action-setup` releases during impl)                                         |
| Lockfile format regression — `lockfileVersion: '9.0'` produced by v11 install isn't readable by anyone still on v9             | permanent | hard error on stale clones with old pnpm: `ERR_PNPM_LOCKFILE_BREAKING_CHANGE`                                                                     | All cohort participants must bump their local pnpm; communicated via the `packageManager` field's auto-switch behavior                    |
| `tools/publish-oidc.mjs` `pnpm pack` step behaves differently under v11 (e.g., changed tarball layout)                         | runtime   | publish workflow fails or publishes broken tarballs                                                                                               | Audit during impl; the script does `pnpm pack` which is workspace-aware — verify `workspace:*` still resolves to concrete versions in v11 |

Per Tenet 4 (Fail Loud): the silent-degradation row (`.npmrc` engine-strict drop) needs explicit verification, not silent acceptance. If v11 doesn't warn when ignoring non-auth `.npmrc` keys, this is a Tenet 4 violation we'd be importing — manual test required as part of impl verification.

### Invariants to lock in via tests

These are pre-push / CI gates rather than vitest unit tests (this is a config bump, not new code surface):

1. **`pnpm install` on Node 24 from clean checkout succeeds** with no missing-binary postinstall errors (esbuild, lancedb, apache-arrow native paths all functional).
2. **`pnpm exec totem lint` runs end-to-end** — verifies that the install completed enough to make the `totem` binary executable and its deps loadable.
3. **`pnpm --filter @mmnto/cli test` passes 2262/2262** — full cli suite stays green under the new pnpm.
4. **CI matrix passes on ubuntu / macos / windows** — confirms cross-platform install + build + test parity.
5. **`engine-strict` discipline is still active post-migration** — manual test: temporarily downgrade Node to 22 locally; `pnpm install` should fail with `ERR_PNPM_UNSUPPORTED_ENGINE` exactly as it does today. Restore Node 24.
6. **Lockfile is byte-deterministic across re-installs** — `pnpm install --frozen-lockfile` after a `pnpm install` (no-arg) produces no diff.

### Open questions

1. **Skip v10 entirely or stage v9 → v10 → v11 across multiple PRs?**
   - **Options:**
     - (a) **Direct to v11.2.2** — one PR; tests v9 → v11 jump in one shot; if it breaks, the bisect surface is larger
     - (b) **Two PRs: v9 → v10 first, then v10 → v11** — isolates v10's lifecycle-scripts breaking change from v11's `.npmrc` migration + supply-chain defaults; each PR is smaller and easier to revert
   - **Recommendation:** (a). The wave plan explicitly named `@9.15.4 → @11.2.2` as the W4 target. Two PRs doubles the CI/bot R-walk overhead. The breaking changes are well-documented and the audit is done. If we hit a snag, we can downgrade-and-stage as a follow-on rather than pre-stage.

2. **`pnpm.allowBuilds` (v11 form) vs `pnpm.onlyBuiltDependencies` (v10 form)?**
   - **Options:**
     - (a) **`pnpm.allowBuilds`** — v11 native form; matches the major we're landing on
     - (b) **`pnpm.onlyBuiltDependencies`** — v10 form; might still work under v11 (need to verify); future-warning may appear
   - **Recommendation:** (a). We're targeting v11.2.2 directly; use the v11 form. If v11 supports both as aliases, it's still cleaner to use the canonical name.

3. **Override `minimumReleaseAge` to 0 for cohort CI?**
   - **Options:**
     - (a) **Yes — set `minimumReleaseAge: 0` in `pnpm-workspace.yaml`** — restores the v9/v10 behavior; cohort CI continues to install freshly-published `@mmnto/*` packages immediately
     - (b) **No — accept the 24h delay** — embraces v11's supply-chain default; but breaks the cohort publish-then-install loop in CI (we'd need a workaround like waiting 24h or using a per-package override)
     - (c) **Yes, but scoped narrowly** — override `minimumReleaseAge` to 0 ONLY for `@mmnto/*` packages, not all deps. Need to verify if pnpm v11 supports per-scope `minimumReleaseAge`.
   - **Recommendation:** (a) for the bump itself; revisit (c) as a follow-on once we've shipped baseline v11 compatibility. Setting to 0 wholesale matches what we had pre-v11; supply-chain hygiene can be tightened later via a separate cycle once we've verified the broader install path works.

4. **`pnpm/action-setup` version pin in workflows?**
   - **Options:**
     - (a) **Stay on `@v5` and rely on `packageManager` field for version inference** — pnpm's recommended approach; single source of truth
     - (b) **Explicitly pin with `with: { version: 11.2.2 }` in every workflow** — belt-and-suspenders; matches the cohort engine-strict discipline
   - **Recommendation:** (a). v11's `manage-package-manager-versions` default makes the `packageManager` field authoritative; duplicating it in workflows reintroduces the same drift class as the W3 anchor-claim incident. Single source.

5. **`.npmrc` — empty file vs deleted file?**
   - **Options:**
     - (a) **Empty file** — keeps the file as a marker; lower diff churn
     - (b) **Delete file** — cleaner; removes a no-op artifact
   - **Recommendation:** (b). pnpm doesn't care; smaller diff; no semantic loss. Verify no tooling (totem CLI, hooks) checks for `.npmrc`'s existence first.

### Open question — not for the design doc, but for the user

The W4 work is solidly Architectural per the preflight rubric. The design doc above is the artifact. **Phase 4 approval gate applies.** Implementation surface estimate after design: ~6-10 files; ~2 hours coding + lockfile regen + cross-platform CI verification; potentially gnarly if a v10 / v11 release-note item turns out to have a corner case our cohort hits.

The user's call here is whether to:

- **Approve the design as-is and queue implementation for next session** (the lean we already established before invoking `/preflight`)
- **Push back on any open question above** (most likely candidates: skipping v10? minimumReleaseAge override?)
- **Sequence W4 against #1969 / W5** (currently: huddle dispatched on #1969 to strategy-claude; W5 still queued post-W4)
