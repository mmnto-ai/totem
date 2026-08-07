### Problem Statement

The Totem CLI needs a robust and safe `wt` (worktree) command group with subcommands to manage and verify git worktrees (`create`, `remove`, and `verify`). The tool must proactively handle environment verification, prevent branch checkout conflicts, and guarantee safe, "check-first" directory removals.

### Architectural Context

- **Check-First Live Check Pattern:** Inspired by `removeAuthorSandbox` in `packages/cli/src/author-sandbox.ts`, the CLI must verify whether a directory is a registered, live worktree in git's database before executing removal commands. We must never "fail-open" or blindly attempt disk deletion.
- **Shared Helpers Usage:** All Git operations must run through the shared `safeExec` helper from `@mmnto/totem` using structured array parameters. Repository resolution must use `resolveGitRoot`.

### Files to Examine

1. `packages/cli/src/author-sandbox.ts` — Examine `removeAuthorSandbox` to understand the pattern for querying and cleaning up live git worktrees safely.
2. `packages/cli/src/commands/wt.ts` — This will be the new entrypoint file implementing the `wt` command group, subcommands, and schema contracts.
3. `packages/cli/src/cli.ts` (or the primary CLI definition file) — Read to see how existing command groups and subcommands are registered and configured.

### Technical Approach & Contracts

We will implement three subcommands under a new parent command `wt` (aliased as `worktree`):

- `totem wt create <path> [branch]` — Creates a new worktree at the absolute path target.
- `totem wt remove <path>` — Safely cleans up and deregisters a worktree.
- `totem wt verify` — Checks the health of all registered worktrees, flagging orphaned or corrupt entries.

#### Data Contracts (Zod Schemas)

```typescript
import { z } from 'zod';

export const WorktreeInfoSchema = z.object({
  path: z.string(),
  commit: z.string(),
  branch: z.string().optional(),
  isBare: z.boolean(),
  isDetached: z.boolean(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

export const WtCreateOptionsSchema = z.object({
  path: z.string(),
  branch: z.string().optional(),
  base: z.string().optional(), // e.g., --base main
  force: z.boolean().optional(),
});
export type WtCreateOptions = z.infer<typeof WtCreateOptionsSchema>;

export const WtRemoveOptionsSchema = z.object({
  path: z.string(),
  force: z.boolean().optional(),
});
export type WtRemoveOptions = z.infer<typeof WtRemoveOptionsSchema>;
```

#### Detailed Sequence Logic

1. **`getWorktrees` Helper:**
   - Run `resolveGitRoot(process.cwd())`. If `null`, throw a user-friendly error.
   - Execute `safeExec('git', ['worktree', 'list', '--porcelain'])`.
   - Parse the block-based output (separated by double newlines `\n\n`) to construct a list of `WorktreeInfo` objects with absolute paths.

2. **`create` Flow:**
   - Resolve target path to an absolute path.
   - Verify path does not exist on disk.
   - Parse active worktrees to ensure the target `branch` is not already checked out in another worktree (prevent branch-locking errors).
   - Execute `safeExec('git', ['worktree', 'add', absolutePath, branchName])`.

3. **`remove` Flow:**
   - Resolve path to absolute.
   - Match path against active registered worktrees.
   - If not found in git but directory exists, notify the user.
   - If registered, execute `safeExec('git', ['worktree', 'remove', absolutePath])` (with `--force` if requested).

4. **`verify` Flow:**
   - Retrieve all registered worktrees.
   - For each, check if the directory exists on disk.
   - Flag "orphaned" worktrees (registered in git, missing on disk).
   - Suggest or trigger `git worktree prune`.

---

### Edge Cases & Traps

1. **Relative Path Resolution:** Users often pass relative paths (e.g., `../feature-branch`). If these are not resolved to absolute paths before string-matching with `git worktree list --porcelain`, checks will fail to identify existing worktrees.
2. **Branch Locking:** Git prevents checking out a branch currently active in another worktree. We must intercept this condition early and output a clean user error instead of a raw Git execution panic.
3. **Orphaned Metadata:** If a user deletes a worktree directory using `rm -rf`, Git still retains metadata. Attempting to run `wt create` at that path will fail. Our commands must suggest running `git worktree prune` (or do it automatically) when this state is detected.
4. **Shell Injection Safety:** Never construct commands using template literals (e.g., `` `git worktree remove ${path}` ``). Use `safeExec` with a structured string array for parameters.

---

### Implementation Tasks

- [ ] **Task 1: Implement Worktree Registry Parser (`getWorktrees`)**
  - Create `packages/cli/src/commands/wt.ts` (or a utilities subfolder) and define the `getWorktrees` parser logic.
  - Implement parsing logic for `git worktree list --porcelain` into typed Zod structures.
    > TEST DIRECTIVE: Before implementing, write a failing test named `parsesPorcelainOutputCorrectly` that feeds mock git output with mixed bare, detached, and regular worktrees and verifies output types.
  - Write test → verify fails → implement → verify passes → lint

- [ ] **Task 2: Implement `totem wt create` Command Logic**
  - Implement the creation command, resolving relative paths to absolute paths.
  - Add verification to reject creation if the target branch is already active in another worktree.
    > TEST DIRECTIVE: Before implementing, write a failing test named `rejectsDuplicateActiveBranchCheckout` that asserts a helpful error is thrown when trying to create a worktree on an already checked-out branch.
  - Write test → verify fails → implement → verify passes → lint

- [ ] **Task 3: Implement `totem wt remove` Command Logic**
  - Implement the removal logic using the check-first verification technique.
    > TOTEM INVARIANT (Check-First Rule): Never execute a worktree removal shell call without first verifying that the path is active in the git worktree registry.
    > TEST DIRECTIVE: Before implementing, write a failing test named `rejectsNonWorktreeDirectoryRemoval` that attempts to run remove on a regular directory and asserts that it fails safely without running `git worktree remove`.
  - Write test → verify fails → implement → verify passes → lint

- [ ] **Task 4: Implement `totem wt verify` Command Logic**
  - Implement health check verification logic to scan active worktrees and locate orphaned directories.
  - Add automatic or suggested recovery execution using `git worktree prune`.
    > TEST DIRECTIVE: Before implementing, write a failing test named `flagsOrphanedWorktreesForPruning` that mocks a missing filesystem directory for a registered worktree and confirms it is flagged for prune.
  - Write test → verify fails → implement → verify passes → lint

- [ ] **Task 5: Integrate and Register the Command Group**
  - Import and wire the new subcommands into `packages/cli/src/cli.ts` (or your central commander router).
  - Run a full test suite suite validation and end-to-end integration tests.
  - Write test → verify fails → implement → verify passes → lint

---

### Execution Flow

```dot
digraph workflow {
  spec -> write_test -> verify_fails -> implement -> verify_passes -> lint -> next_task
  verify_fails -> implement [label="RED only"]
  verify_passes -> lint [label="GREEN required"]
  lint -> next_task [label="0 violations"]
  lint -> implement [label="violations found — fix first"]
}
```

---

### Verification

Every implementation MUST end with these steps:

1. `totem lint` — Deterministic static analysis check. Must return zero errors.
2. `totem review` — Supplementary code-diff review.
3. If utilizing MCP, call `verify_execution` to confirm contract completeness before finishing.

---

### Test Plan

- **Unit Tests (`packages/cli/test/commands/wt.test.ts`):**
  - **Parser accuracy:** Verify the `--porcelain` parser handles multi-line blocks, bare repositories, detached heads, and windows/unix path separators correctly.
  - **Resolution safety:** Test that relative paths resolve correctly relative to the Git repository root.
  - **Branch-safety assertions:** Verify that attempting to double-checkout a branch throws an informative error before calling shell operations.
  - **Check-First removal validation:** Mock filesystem states to verify that folder removals are gated cleanly behind registry confirmation.
  - **Pruning validation:** Mock dead worktrees and verify `verify` commands flag them and propose correct remediation CLI calls.

---

## Implementation Design

_2026-08-07, totem-claude preflight for #2580 slice 2. Where this section conflicts with the generated scaffold above, this section governs — the scaffold's `wt verify` subcommand does not survive, and its author-sandbox framing is a precedent, not the pattern. Primary sources: issue #2580 body + all 4 comments; `totem-strategy:doctrine/tool-usage-nuances.md` § Git (canonical removal recipe); `doctrine/cohort-overlay.md` §2 (location + mail convention); lesson-ad03b5cd (cause-as-hypothesis hedge); `packages/core/src/estate-scan.ts` + `registry.ts`; PR #2586 round-3 MINOR-3._

### Scope

Implements `totem wt create|remove|list`: lifecycle verbs backed by a durable user-level worktree registry (`~/.totem/worktrees.json`) with verified removal — the Tenet 4 fix git lacks — plus the sensor coupling: `doctor --estate` sweeps the wt-registry's recorded roots as container roots (the round-3 MINOR-3 remedy: recorded locations stay derivable when every husk's own registry entry is gone). It will NOT: implement signoff coupling (slice 3 — lands inside strategy#650's Prop 298 build, per the fold re-arm correction); classify worktree state in `wt list` (classification stays in the slice-1 sensor — derive-once, the status seat's ruling); wire `TOTEM_WORKSPACE`/`TOTEM_SELF_AGENT` for in-worktree mail (doctrine ruled: mail runs from the primary checkout, full stop); or special-case the reparse-point hypothesis (cause stays open — verify + finish + re-verify whatever the failure mode).

### Data model deltas

**New file `~/.totem/worktrees.json`** — NOT a key in `registry.json`: `RegistrySchema` is `z.record(repoPath, RegistryEntrySchema)`, so any non-repo-entry key fails schema validation and flips the whole registry to "unreadable". Sibling file, own zod schema in a new `packages/core/src/worktree-registry.ts`:

```ts
{
  schemaVersion: 1,
  roots: string[],              // every container root ever created under — accretes, never auto-pruned
  worktrees: Record<absPath, {
    repo: string,               // home repo root (abs)
    seat: string,               // creating seat id
    branch: string,
    ticket?: string,            // e.g. "2580"
    createdAt: string,          // ISO, real instant at write time
  }>                            // entry schema .passthrough() for forward-compat
}
```

- `roots[]`: written by `create` (adds the resolved root, deduped case-folded on win32 only); read by `doctor --estate` (extra container sweep roots) — never removed by `remove`; durability independent of entry lifecycle is the point.
- `worktrees{}`: written by `create` (record-first) and `remove` (deleted ONLY after verified absence); read by `list` and `remove` (path resolution).
- Concurrency: same `acquireLock(~/.totem)` as `registry.json` — one lock dir serializes both files (deliberate; cross-file atomicity not needed). Atomic write: PID-suffixed temp + rename, matching `updateRegistryEntry`.
- No reserved keys or sentinels.

### State lifecycle

- **worktrees.json**: persistent, user-level, host-scoped. Created lazily on first `wt create`. Entry written **before** `git worktree add` (intent record — a phantom entry fails visible via `wt list` "missing"; an unrecorded worktree fails invisible, which is the failure class this issue exists for). Entry deleted only on verified-absent removal. Never auto-trimmed.
- **The worktree dir**: `<root>/<repo>-<seat>-<slug>`. Root precedence: `--root` > `TOTEM_WORKTREE_ROOT` (user-level env per the cohort no-.env rule) > default (open question 1). `create` refuses the workspace root (home repo's parent) and the repo itself — the location class the estate audit indicts. Seat derived via `resolveSelfSender` (exported from `mail.ts`), overridable `--seat`.
- No process-lifetime state; every verb derives fresh (Tenet 20).

### Failure modes

| Failure                                                        | Category  | Agent-facing surface                                                                                                   | Recovery                                                                   |
| -------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| create: target dir already exists                              | init      | hard error naming path                                                                                                 | new slug, or remove residue first                                          |
| create: branch already checked out elsewhere                   | init      | hard error (git's message, sanitized)                                                                                  | different branch                                                           |
| create: registry write fails                                   | init      | hard error BEFORE any git mutation (record-first)                                                                      | fix `~/.totem` perms; nothing to clean                                     |
| create: `git worktree add` fails after record                  | runtime   | hard error + best-effort entry rollback; failed rollback names the phantom entry                                       | re-run create, or `wt remove <path>`                                       |
| create: root is workspace/repo root                            | init      | hard error citing cohort-overlay §2                                                                                    | use conventional root                                                      |
| remove: untracked content under `<wt>/.totem/orchestration/**` | init      | hard refusal listing the files + ecl-discipline §4.6 pointer; no bypass in v1 (open question 2)                        | consolidate ECL, re-run                                                    |
| remove: path in neither git's list nor wt-registry             | init      | hard error; nothing touched                                                                                            | —                                                                          |
| remove: `git worktree remove` itself fails                     | runtime   | hard error (sanitized stderr)                                                                                          | fix cause, re-run                                                          |
| remove: dir present after git remove (the exit-0 husk)         | runtime   | proceeds to residue finish: lstat-walk deletes reparse points WITHOUT following, then recursive delete, then re-verify | automatic — the verb's reason to exist                                     |
| remove: dir STILL present after finish                         | permanent | hard error naming path + surviving entries; registry entry RETAINED                                                    | manual cleanup; entry keeps the failure visible                            |
| remove: registry delete fails after verified absence           | runtime   | loud warning (dir gone, record stale)                                                                                  | re-run remove — idempotent: verified-absent + entry present ⇒ delete entry |
| list: worktrees.json unreadable                                | runtime   | loud warn + empty listing (mirrors `readRegistry`)                                                                     | repair/delete file                                                         |
| doctor-estate: worktrees.json unreadable                       | runtime   | disclosed as an excluded source; scan proceeds (degraded scan never reports dirtier — container-withdrawal precedent)  | repair file                                                                |

No silent-degradation rows.

### Invariants to lock in via tests

1. `wt remove` can never exit 0 while the directory still exists — success ⇔ verified absence (the git fail-open must not survive the wrapper).
2. A registry entry is deleted only after verified absence; every removal failure retains it.
3. Residue deletion never follows a junction/symlink out of the tree — a junction's TARGET survives deletion of the worktree dir (fixture: junction inside a fake worktree pointing outside).
4. A path git lists goes through `git worktree remove`; a path git does NOT list is never passed to `git worktree remove` (check-first) — and its finish path still ends in verify-absence.
5. Untracked content under `.totem/orchestration/**` blocks removal; tracked-only orchestration content does not.
6. `create` writes the entry before invoking git; a git failure rolls it back or reports the phantom loudly.
7. No wt verb ever writes `registry.json` (schema-collision guard); its read path is untouched.
8. Recorded roots survive entry removal, and `scanEstate` receives them as container roots — the `%TEMP%\claude` class stays reachable with zero live entries.
9. Path comparisons case-fold on win32 only (author-sandbox precedent).
10. `create` mints no worktree under the workspace root or repo root, under any flag combination.

### Open questions

1. **Default worktree root when `TOTEM_WORKTREE_ROOT` is unset?**
   - **(a) `~/.totem/worktrees`** — zero-config, user-level, outside every mail/discovery glob, survives tmp cleaners. Caveat on this host: C:-drive location while repos live on D: degrades pnpm hard-links to copies (slower, bigger installs).
   - **(b) No default — unset env is a hard error** naming the var. Matches "convention specifics agent-derived" (operator rules the location once, per host); one-time setup friction.
   - **(c) `os.tmpdir()/totem-worktrees`** — zero-config, but collides with estate-scan's deliberate tmpdir suppression rationale and the "shared tmp = presumed deletable" doctrine line.
   - **Recommendation:** (a), with the env override documented; you'd likely set `TOTEM_WORKTREE_ROOT=D:\tmp` on this host for drive locality. The doctrine twin's "shared tmp root" wording then gets a follow-up amendment to "the wt-verb's root" (strategy lane).
2. **ECL-block bypass flag on `remove`?** Recommendation: none in v1 — the refusal lists the exact files and the consolidate step is short; a bypass would re-open the untracked-content-deleted-silently hole this verb closes. Add later only if the refusal proves noisy on tracked-vs-untracked edge cases.
3. **Sensor coupling in this PR or a follow-up?** Recommendation: this PR — it's ~10 lines (doctor-estate reads wt-registry roots, passes as extra container roots into `scanEstate`), it discharges the round-3 MINOR-3 carry, and shipping the verbs without it re-creates the unreachable-root gap the comment documents.

### Rulings (operator greenlight 2026-08-07, "using your recs")

- **Q1 → (a):** default root `~/.totem/worktrees`, `TOTEM_WORKTREE_ROOT` override (user-level env). Doctrine-twin "shared tmp root" wording amendment routes to the strategy lane coupled with this PR.
- **Q2 → no bypass flag in v1.** The ECL refusal lists the exact files; consolidate-then-re-run is the only path.
- **Q3 → sensor coupling ships in this PR.** Derived wt-registry roots are filtered to directories that exist (an absent recorded root is an empty sweep, not a scan hole — mirrors the missing-registry-entry precedent); explicit `--root` behavior unchanged (a named root that fails to read stays an unscannable row).
- Design approved at the same word. Additional bound contract details settled at ruling time: `create` uses `git worktree add -b` (always a NEW branch; an existing branch is a hard error in v1); default branch name `feat/<ticket>-<slug>` when `--ticket` is given, else `wt/<slug>`, overridable `--branch`; ECL check runs `git -C <wt> status --porcelain --ignored -- .totem/orchestration` and blocks on ANY row (ignored ECL files are still ECL); `remove` accepts a git-listed worktree with no registry entry (legacy estate) — registry deletion just no-ops.

Releasable slice: one PR, `feat(cli,core)`, changeset minor for `@mmnto/totem` + `@mmnto/cli`.
