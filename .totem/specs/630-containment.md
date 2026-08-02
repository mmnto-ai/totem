# Spec: strategy#630 containment block — lockfile pin-removal gate + #2535 untracked-file disclosure + #2536 rituals-text truth-up

**Anchors:** mmnto-ai/totem-strategy#630 (containment, Prop 309 queue-jump; live-fire evidence comment 5152301962) · mmnto-ai/totem#2535 · mmnto-ai/totem#2536. Operator-ruled 2026-08-01 (queue word via strategy-claude 2113Z dispatch; greenlit in-session with postmerge extraction for #2538 + #2544 riding as cargo).

> Note: the first generation of this spec (Gemini scaffold) retrieval-matched an unrelated
> path-containment helper off the "containment" slug and was discarded; this spec is
> hand-authored from the primary sources.

### Problem Statement

Three slices, one train:

1. **(strategy#630) Lockfile pin-removal gate.** A failed optional-dependency fetch (dead npm token) during `pnpm install` silently removes all lockfile entries (importer, resolution, snapshot) for a working dep while `package.json` keeps the pin — exit 0, 226ms. Both deterministic gates pass: `verify-lockfile-sync` fast-passes the moment `pnpm-lock.yaml` appears in the diff range (verify-lockfile-sync.ts:130), and frozen-lockfile CI accepts an internally-consistent lock that merely omits an optional dep. Only seat inspection caught the live-fire (an 11-deletion stat on what should have been a version swap).
2. **(#2535) `totem lint` untracked-file lie.** A working tree whose only change is an untracked file reports `No changes detected. Nothing to review.` exit 0 (git.ts:348/:385) — a clean exit that reviewed nothing, on the command that gates pushes. The #2473 exit-0 class via the untracked path.
3. **(#2536) Rituals text bills LLM lanes as THE review.** init-templates.ts:49 ("Before PR: Run `totem review` for a full AI-powered code review") + the managed prepush-skill wording + docs.ts:61 billing. Live near-miss: an LC seat nearly ran LLM lanes on a ~100k-char diff (truncation class #2524) because the template told it to.

### Architectural Context

- `verify-lockfile-sync` is the cohort-sync gate (#1961), wired into `tools/pre-push` and consumer-scaffolded hooks; CLI command + programmatic surface; best-effort fall-through-to-pass on git failures (Tenet 4 init-class carve-out, #1440, `totem-context` directives at each site). The new predicate extends THIS command — no new surface (Tenet 5 scope discipline: the governance boundary already exists here).
- Disposition (b) from the dispatch — reclassify strategy-doctrine out of optionalDependencies, or document-and-let-the-rule-carry: **KEEP optionalDependencies.** Evidence: all 12 PR CI workflows run `pnpm install --frozen-lockfile` with no NPM_TOKEN — totem's own CI depends on the unauth clean-skip (#2095 property; doctrine #558; strategy#630 body explicitly rules out dropping optionalDeps). The new gate carries the protection instead. Ruling to be recorded on strategy#630 post-merge.
- `totem lint` accepts NO positional file targets (options only: --staged/--branch/--base) — so #2535's "named target unexamined" variant is moot; the honest fix is loud disclosure in the empty-diff path. Exit stays 0: the pre-push hook runs `totem lint`, and untracked scratch files are routine in a working tree during a legitimate push — a non-zero exit would mint a false-block class (Totem is NOT zero-user).
- #2536 wording is product surface (T0) — the cohort review-leg contract is T1 and never ships in the template (strategy#619 sterilization rule). Bus-drafted replacement wording exists; totem-claude owns final form. The Rituals section lives inside `AI_PROMPT_BLOCK`; init.test.ts parity suites pin template content (skill-parity invariant at init.test.ts:~2619 — verify which suites re-pin).

### Files to Touch

1. `packages/cli/src/commands/verify-lockfile-sync.ts` + `.test.ts` — the removed-pin predicate inside the fast-pass branch.
2. `packages/cli/src/git.ts` (:348/:385 no-changes paths) + `git.test.ts` — untracked disclosure.
3. `packages/cli/src/commands/init-templates.ts` (:49) + init.test.ts — Rituals wording.
4. Managed prepush-skill wording (locate scaffold source; `.claude/skills/prepush/SKILL.md` local render).
5. `packages/cli/src/commands/docs.ts` (:61) — align `totem review` billing.
6. `totem review` run-start self-description banner (one log line; locate review entry).
7. `docs/wiki/cli-reference.md` — verify-lockfile-sync section: new failure class + optional-dep hazard note.
8. `.changeset/` — releasable slice (patch/minor for @mmnto/cli).
9. Riding cargo: postmerge extract-only lessons for #2538 + #2544 (re-read freeze do-not list first; NO compile).

### Verification

`pnpm -r build` → package tests → full-branch `totem lint` + repo-wide `format:check` → `totem review` (advisory) → falsification leg before presenting for merge (overlay §5 @ 0.1.28).

## Implementation Design

### Scope

Extend `verify-lockfile-sync` to fail loud when a lockfile diff fully removes a package whose pin remains declared in any tracked `package.json` at HEAD; make `totem lint`'s empty-diff verdict disclose untracked files; truth-up the three `totem review` billing surfaces. Will NOT: change optionalDependencies classification, touch pnpm behavior, add network calls, change `VerifyLockfileSyncResult`'s shape, alter lint exit codes, or ship cohort/T1 vocabulary into product templates.

### Data model deltas

- No new exported types. `VerifyLockfileSyncResult` unchanged; multiple removed pins join in one `reason` string.
- Internal only: candidate set `Set<string>` of package names parsed from removed lockfile-diff key lines (per-invocation, function-local). Over-generation is safe by design — the decisive predicate downstream filters; under-generation is the correctness risk.
- No reserved keys, no sentinels, no module-level state.

### State lifecycle

None. All computation is per-invocation and function-local; the command remains stateless (reads git, returns a result). No caches, no files written.

### Failure modes

| Failure                                   | Category  | Agent-facing surface                                                       | Recovery                                                                                                                                                                    |
| ----------------------------------------- | --------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Removed-pin detected (live-fire class)    | runtime   | hard error (CHECK_FAILED, exit ≠0)                                         | recovery hint: verify `npm whoami`, regen via `pnpm update <pkg>` (NOT `--lockfile-only`, which false-passes on optional drops), commit lockfile                            |
| Lockfile diff read fails mid-check        | transient | logged skip, gate passes                                                   | existing #1440 init-class carve-out, `totem-context` directive at site                                                                                                      |
| HEAD-lockfile or package.json probe fails | transient | logged skip, gate passes                                                   | same carve-out; probes are read-only git ops                                                                                                                                |
| Candidate parse finds nothing             | —         | PASS (normal path)                                                         | n/a                                                                                                                                                                         |
| lint: empty diff + untracked present      | runtime   | loud disclosure warning naming files + "this run examined nothing"; exit 0 | stage files to include them; exit-0 justified: non-zero would false-block routine pushes via the pre-push hook (Tenet 4 satisfied by the loud declaration, #2473 precedent) |
| lint: untracked probe fails               | transient | current message unchanged                                                  | probe is best-effort; never blocks                                                                                                                                          |
| review banner                             | —         | one informational line, no failure mode                                    | n/a                                                                                                                                                                         |

### Invariants to lock in via tests

- A lockfile diff removing importer+packages+snapshots entries for a package still declared (incl. in `optionalDependencies`) in a package.json at HEAD → `valid:false`, reason names the package. Positive-control fixture models the live-fire diff (provenance: strategy#630 comment 5152301962).
- A pure version bump (old `pkg@A` key removed, new `pkg@B` key added) → PASS.
- A legitimate removal (declaration deleted in the same diff range) → PASS.
- A dedupe removing one version's key while the package still resolves in the HEAD lockfile → PASS.
- All pre-existing gate behaviors byte-identical (pin-add-without-lockfile still fails; clean fast-pass still passes; skip preconditions untouched).
- lint: empty diff + no untracked → message byte-identical to today. Empty diff + untracked → disclosure lists files and states nothing was examined; exit 0.
- Template/docs: new wording present; AI_PROMPT_BLOCK parity suites pass; no T1 vocabulary in any product surface (grep-assert "review-leg", "cohort", "falsification" absent from template deltas).

### Open questions

1. **Q: #2535 exit semantics — disclosure + exit 0, or a distinct non-zero "nothing examined" exit?**
   Options: (a) loud disclosure, exit 0 — honest, zero false-block risk; (b) non-zero — stricter, but the pre-push hook runs `totem lint`, so any untracked scratch file would block unrelated pushes for every consumer.
   **Recommendation: (a).**
2. **Q: Disposition (b) — keep strategy-doctrine in optionalDependencies?**
   Options: keep + let the new gate carry it (unauth CI stays green; matches #558/#2095 and strategy#630's body) · reclassify to dependencies (requires NPM_TOKEN in ~12 workflows, breaks unauth consumer installs).
   **Recommendation: keep; record the ruling on strategy#630 after merge.**
3. **Q: Include the `totem review` self-description banner (#2536 third deliverable) in this train?**
   Options: include (one log line, corrects stale muscle memory at point of invocation) · defer as nice-to-have.
   **Recommendation: include.**
