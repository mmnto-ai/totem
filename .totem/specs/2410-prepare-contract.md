# Spec: #2410 — prepare-script contract build slice (strategy#894 Option B)

> Provenance: hand-authored from mmnto-ai/totem#2410, the strategy#894 ruling
> (comment 5000993265), and source reads of install-hooks.ts / init.ts /
> init-templates.ts / doctor-parity.ts. The `totem spec` generation for this
> slug produced an unrelated hallucinated task (ParityContract utility) and was
> discarded — recorded as a spec-lane datapoint on mmnto-ai/totem#2106.

### Problem statement

Three slices, landing as two PRs (A = slices 2+3, fork-independent of the
convention text strategy is authoring concurrently; B = slice 1, carries the
couple-on-merge gate):

1. **(PR-B)** `totem init` distributes a managed `.cjs` prepare wrapper;
   consumer `package.json` `prepare` invokes it. ENOENT → declared skip 0;
   CLI present → `totem hook install`; genuine failure → exit 1.
2. **(PR-A)** Dedicated exit-code contract test block on `hooksCommand`.
3. **(PR-A)** Managed session-hook regeneration: marker-headed whole-file
   artifacts (`.claude/hooks/*.cjs`, `.gemini/hooks/*.js`) gain the #2406
   bounded drift-repair semantics, reachable via `totem hook install`.

### Ground truth (verified at source, 1.100.0)

- `hooksCommand` (install-hooks.ts:800): not-a-git-repo → stderr notice +
  return **0**; hook-manager detected → guidance + **0**; `--check` ok → **0**,
  missing → `process.exit(1)`; install path throws → `handleError` → **≠0**.
- install-hooks.ts:820 `--check` failure remedy still names the deprecated
  plural `totem hooks`.
- `installGitHook` classes: `installed | exists | appended | skipped-non-shell |
overwritten`; bare drift-repair requires bounded ownership
  (`isTotemOwnedWholeFile`: marker opens file, end marker present, nothing after).
- `hooksCommand` prints "Force-overwritten" for `overwritten` even when the
  write was a bare (no-force) drift-repair.
- `scaffoldFile` (init.ts:95): marker present → `exists`, never refreshes —
  the lc#806 stale-SessionStart mechanism. Session-hook templates carry a
  header marker (`TOTEM_FILE_MARKER`) but **no end marker** today.
- Eject's `TOTEM_SCAFFOLDED_FILES` enumerates the fully-totem-owned artifacts.

## Implementation Design

### Scope

PR-A freezes `hooksCommand`'s exit-code contract in tests, fixes the stale
remedy verb and the misleading bare-repair message, and extends bounded
drift-repair to managed session hooks behind `totem hook install`. PR-B adds
the init-distributed prepare wrapper + package.json wiring + a doctor parity
row. NOT in scope: convention text (strategy's lane), consumer-repo
propagation, totem's own `tools/` byte-identity variant, `--check` growing
session-hook coverage (doctor `--parity` stays the drift sensor), any change
to skills/settings.json distribution.

### Data model deltas

- **`MANAGED_SESSION_HOOKS: ReadonlyArray<{rel: string; content: string; marker: string; endMarker: string}>`**
  (new, init-templates.ts) — the regeneration roster: `.claude/hooks/{PreWriteShield,SessionStart,gate-wrapper}.cjs`,
  `.gemini/hooks/{SessionStart,BeforeTool}.js`. Written at module load from
  existing template constants; read by init's installers, `hook install`, and
  the tools-parity test. Invariant: every entry's `content` embeds its own
  `marker` + `endMarker` (locked by test).
- **End markers on session-hook templates** (new constants, e.g.
  `TOTEM_FILE_END = '// [totem] end auto-generated'`) — appended to each
  template. Same collision rules as #2406 git-hook end markers.
- **`scaffoldFile` return union gains `'refreshed'`** (init.ts) — emitted only
  on bounded drift-repair. Callers mapping to `HookInstallerResult` map
  `refreshed → 'merged'` (mirrors scaffoldClaudeSkill's mapping).
- **PR-B: `PREPARE_WRAPPER` template** (init-templates.ts) — dependency-free
  `.cjs`, distributed to `.totem/prepare.cjs`, marker-headed + end-marker-bounded,
  member of the regeneration roster. Resolves the CLI via
  `require.resolve('@mmnto/cli/package.json')` → bin path, spawns
  `process.execPath [bin, 'hook', 'install']` (never a shell — Windows
  quoting class, #2351); `MODULE_NOT_FOUND` → declared-skip notice + exit 0;
  child exit code propagated verbatim.
- No new config fields. No reserved keys.

### State lifecycle

All artifacts are persistent committed files in the consumer repo, owned at
write time by whichever verb ran (`init` or `hook install`) — single-writer
per invocation, no runtime state containers. The wrapper is stateless per
`pnpm install` run. Roster constants are module-lifetime immutables.

### Failure modes

| Failure                                                                         | Category               | Agent-facing surface                                                                                             | Recovery                                                   |
| ------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `hook install` outside a git repo                                               | init                   | stderr notice, exit 0 (declared skip — contract-frozen)                                                          | run inside a repo                                          |
| `--check` with missing/markerless hooks                                         | runtime                | stderr + exit 1 (contract-frozen); remedy now names `totem hook install`                                         | run `totem hook install`                                   |
| Hook write throws (perms/FS)                                                    | runtime                | thrown → `handleError` → exit ≠0                                                                                 | fix FS state, rerun                                        |
| Session hook exists, marker-headed, **no end marker** (all current deployments) | permanent-until-forced | `exists` + one-line notice naming `--force` (mirrors #2406 legacy path; doctor `--parity` already prescribes it) | one `totem hook install --force`, then bounded self-repair |
| Session hook user-owned (no marker / content after end marker)                  | permanent              | `skipped`/`exists`, never overwritten without `--force`                                                          | user merges manually or forces                             |
| Wrapper: CLI unresolvable                                                       | init                   | stderr declared-skip notice, exit 0 (strategy#630 class)                                                         | install @mmnto/cli, reinstall                              |
| Wrapper: CLI resolvable but `hook install` fails                                | runtime                | child's stderr, exit code propagated ≠0 — **prepare fails loud** (the #894 Tenet-4 core)                         | fix underlying failure                                     |
| PR-B: `package.json` has a different existing `prepare`                         | permanent              | init declines + prints the canonical line to add (no overwrite of user-owned content)                            | user wires manually                                        |
| PR-B: `package.json` unparseable                                                | runtime                | init error surface (existing readJson posture)                                                                   | fix JSON                                                   |

No silent-degradation rows.

### Invariants to lock in via tests (the slice-2 contract block)

- Exit 0 ⟺ {fresh install, already-current, bounded drift-repair, declared
  skips (non-repo, hook-manager)}; exit ≠0 ⟺ genuine failure; `--check` is
  exactly 0/1 on all-present-with-marker vs not.
- Bare install never mutates a file that is not a bounded totem-owned whole
  file (git hook OR session hook); `--force` is the only unbounded write.
- A legacy marker-headed session hook without an end marker is never bare-repaired.
- Regenerated artifacts always carry marker + end marker (roster invariant),
  so post-`--force` files are self-repairing.
- `overwritten` via bare repair and via `--force` print distinct messages
  ("Drift-repaired…" vs "Force-overwritten…").
- Wrapper: exit code is 0 on MODULE_NOT_FOUND, equals child exit otherwise;
  never spawns through a shell.
- PR-B init: `prepare` entry is added only when absent or already-canonical.

### Open questions

1. **Question:** Session-hook end-marker migration means every existing
   deployment (including totem's own and lc's) declines bare repair until one
   `--force`. Accept?
   **Options:** (a) accept — identical to the shipped #2406 git-hook migration,
   doctor remedy already prescribes `--force`; (b) grandfather markerless files
   into bare repair — violates the bounded-ownership lesson (clobbers appended
   user content).
   **Recommendation:** (a).
2. **Question:** Wrapper home path. **Options:** `.totem/prepare.cjs`
   (neutral, beside `.totem/hooks/` precedent); `tools/` (collides with
   totem-repo-only convention). **Recommendation:** `.totem/prepare.cjs`.
3. **Question:** Should `hook install` (not just init) also distribute the
   wrapper file itself? **Options:** (a) no — init distributes, hook install
   regenerates roster members it finds present; (b) yes — hook install creates
   it too. **Recommendation:** (a): creation is an adoption decision (init),
   regeneration is maintenance (hook install); avoids surprise file creation
   in repos that opted out.

### Verification

Per slice: failing test first → implement → `pnpm -r build && pnpm -r test` →
full-branch `totem lint --base main` → repo-wide `format:check` + ESLint →
changeset (minor, @mmnto/cli; consumer-impact tag shape) → PR. PR-B merge
additionally gated on: poll `totem mail` + re-read strategy#894 convention
state (couple-on-merge).
