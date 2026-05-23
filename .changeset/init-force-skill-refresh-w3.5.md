---
'@mmnto/cli': minor
---

feat(cli): `totem init --force-skill-refresh` flag for canonical-marker-less skill files (W3.5)

Adds a narrow CLI flag that overrides `scaffoldClaudeSkill`'s `preserved` outcome when a distributed Claude skill file lacks the canonical `TOTEM_SKILL_*` markers. Default behavior is unchanged — without the flag, marker-less skill files continue to be preserved with a migration hint. With the flag, the file is overwritten with canonical content and the destructive event is surfaced via a per-file `log.warn` plus a dedicated summary line.

## What ships

- **New CLI flag:** `totem init --force-skill-refresh`
- **New scaffolder option:** `scaffoldClaudeSkill(path, content, { force?: boolean })`
- **New result metadata field:** `scaffoldClaudeSkill` returns `forceSuppressed?: true` only when the no-marker guard was suppressed by force
- **New result metadata field:** `HookInstallerResult.summaryActionOverride?: string` for callers to override the default summary action text
- **Widened signature:** `AiToolInfo.hookInstaller?: (cwd, opts?: { forceSkillRefresh?: boolean }) => …`

## Scope (narrow, per strategy-claude lean at `2026-05-23T1819Z`)

| In                                                                                           | Out                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Single flag override on the no-marker guard for distributed Claude skills                    | `.claude/settings.json` `permissions.allow` merging (Layer 1, stays in `#2008`)                                                         |
| Per-file destructive-by-consent warning (only on suppression path)                           | `.mcp.json` dedup (Layer 1)                                                                                                             |
| Summary line that mirrors the warning text for grep parity                                   | Opt-in hooks (Layer 1)                                                                                                                  |
| Below-marker user customization stays intact under force (cross-marker contract is separate) | Opt-in baselines (Layer 1)                                                                                                              |
| Skills only — reflexes (CLAUDE.md / GEMINI.md) are out of scope                              | Refresh-flag cohort (`--refresh-skills` / `--refresh-reflexes` / `--install-hooks` / `--install-baselines`) — Layer 2, stays in `#2008` |

The bulldoze-everything semantics (overwrite below-end-marker user customization too) intentionally do NOT ship — that's a different command (`--force-skill-replace` or `--scrub`) with its own design pass if/when needed.

## Why this exists

Closes the W3.5 narrow precedent surfaced at [`mmnto-ai/totem#2008`](https://github.com/mmnto-ai/totem/issues/2008). Cohort consumers hitting the canonical-marker mismatch on already-initialized repos had no override path — the only options were manual file deletion (and re-init) or living with stale skill content. The flag is the explicit consent path for the destructive overwrite.

## Test coverage

7 new unit tests covering all 8 invariants from `.totem/specs/2008.md § Implementation Design (W3.5 narrow scope)`:

1. Default behavior unchanged (no force → marker-less stays preserved)
2. Force overrides preservation (forceSuppressed: true, content == canonical)
3. Fresh repo + force is no-op (created outcome, no forceSuppressed)
4. Below-marker user content preserved under force on marker-bearing files
5. Marker-bearing files refresh without spurious forceSuppressed flag
6. Per-skill failure isolation (covered structurally — each iteration is independent)
7. CLI flag round-trip (Commander → initCommand → installClaudeHooks → scaffoldClaudeSkill; truthy check is `=== true` so default-undefined and default-false both work)
8. **forceSuppressed is set ONLY on the no-marker suppression path** — locks signal-to-noise discipline (no spurious warns on the normal refresh path)

Plus an assertion that the preserve-path error hint advertises the `--force-skill-refresh` flag so users discover the override at the moment they hit the preserve outcome.
