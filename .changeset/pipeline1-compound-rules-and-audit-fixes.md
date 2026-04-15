---
'@mmnto/totem': patch
---

Pipeline 1 compound rule authoring + first three production compound rules + fail-loud git.ts / rule-engine.ts

**Pipeline 1 compound extension (new capability).** `extractManualPattern` now accepts a yaml-tagged fenced code block following the `**Pattern:**` field marker in a lesson body. The parsed NapiConfig object routes through `buildManualRule` into the `astGrepYamlRule` field on the compiled rule (same path the LLM-driven Pipeline 2 uses). Pack authors no longer need Sonnet in the loop to hand-author compound rules with `inside` / `has` / `not` combinators.

New export from `@mmnto/totem`: `extractYamlRuleAfterField(body, field)`. Accepts ` `yaml ```or`~~~yaml`fences. Scans stop at the next bold-field marker or EOF so subsequent`**Message:**`/`### Bad Example` / narrative sections live freely. Bare untagged fences are ignored so prose code blocks below the pattern pass through.

**Three inaugural compound rules shipped** (all manual Pipeline 1, first production compound rules in the manifest):

- `Ban fail-open catch blocks that swallow errors without re-throwing` — matches `catch_clause` where the body subtree has no `throw_statement`. Compound form: `rule.kind: catch_clause, not.has.throw_statement (stopBy: end)`. The escape hatch is `// totem-ignore-next-line` above the offending catch for genuine best-effort cleanup.
- `` Ban `spawn()` / `spawnSync()` with `shell: true` `` — `any:` disjunction over the two call names plus `has:` descendant check on a `shell: true` pair. Scope-excludes `packages/cli/src/orchestrators/shell-orchestrator.ts` (the single legitimate `shell: true` site, secured by `MODEL_SAFE_RE` and `quoteShellArg` in 1.14.10).
- ``Ban `export let` declarations (exported module-level mutable state)`` — targets `export_statement` with a `lexical_declaration` child matching `let`. Zero current violations; forward protection ahead of 1.15.0 Pack Distribution.

**Fail-loud audit fixes (closes mmnto/totem#1440 and mmnto/totem#1442).**

- `isFileDirty(cwd, filePath)` — previously returned `false` on any git failure. Now throws `TotemGitError` on non-ENOENT git failures so callers like `docs` (data-loss-protection filter) cannot mistake "git broke" for "file is clean." Pure ENOENT "git missing" still routes through the existing `throwIfGitMissing` helper.
- `resolveGitRoot(cwd)` — previously returned `null` on any git failure, conflating "not in a git repo" (legitimate) with "git broken" (bug). Now returns `null` only when the error message matches `/not a git repository/i`; other failures throw. The `string | null` contract is preserved for the one documented case.
- `applyRulesToAdditions` (regex engine) — previously swallowed invalid-regex errors with `continue`, so a corrupted manifest entry would mark the diff "compliant" with a load-bearing rule mute. Now throws `TotemError` (code `CHECK_FAILED`) naming the lesson hash and pattern, so the operator sees exactly which rule to fix or archive.

Cosmetic git helpers that legitimately fall back to display strings (`getGitBranch`, `getGitStatus`, `getGitDiffStat`, `getTagDate`, `getLatestTag`, `getGitLogSince`) keep their silent-fallback behavior but now carry `// totem-ignore` comments documenting the exception. The intermediate `getDefaultBranch` probe-loop catch is also marked with `// totem-ignore` (the outer function throws if every candidate fails — intentional control flow).

**Tests:** +11 in `lesson-pattern.test.ts` for the yaml-fence extractor, +0 net in `git.test.ts` and `compiler.test.ts` (two existing tests were updated to assert the new throw behavior, with issue references in the test names).

Thanks to Gemini for the pre-1.15.0 deep review audit (mmnto/totem#1421) that surfaced both #1440 and #1442 and drafted the three compound rule YAML shapes.
