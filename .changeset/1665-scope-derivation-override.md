---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

fix(core+cli): honor source-declared `**Scope:**` over LLM emission on Pipeline 2/3 (#1665)

Strategy item 023 substrate. Inverse of `mmnto-ai/totem#1626` (auto-ADD): the compile worker silently DROPPED test/spec exclusion globs (`!**/*.test.*`, `!**/*.spec.*`) that lessons declared in their `**Scope:**` line. Confirmed twice on `mmnto-ai/liquid-city#80` for rules `5bcc8aad9096c817` and `6c457c82d3945d15`.

- New `parseDeclaredScope(body)` helper in `@mmnto/totem` that parses the lesson body's `**Scope:**` prose declaration into a glob list. Preserves `!`-prefixed exclusion entries verbatim and preserves authored order. Returns `undefined` for missing/empty/whitespace-only declarations.
- New `isGlobSetEqual(a, b)` pure helper for set-of-strings comparison. Order-insensitive, duplicate-insensitive, sign-sensitive (`'!**/*.test.*'` does not equal `'**/*.test.*'`).
- `extractManualPattern` (Pipeline 1) refactored to delegate Scope parsing to `parseDeclaredScope` so the manual flow shares a single source of truth with Pipeline 2/3.
- `BuildCompiledRuleOptions.lessonBody?: string` opts callers into the override path. When supplied AND the body declares a `**Scope:**` line, the parsed source-Scope glob list takes precedence over `parsed.fileGlobs` regardless of LLM emission. Both lists pass through `sanitizeFileGlobs` for parity (shallow → recursive normalization).
- `BuildRuleResult.scopeOverride?: { from: string[] | undefined; to: string[] }` reports the override event when the override actually changed the emitted globs. Threaded through rejection paths too. Mirrors `severityOverride` discipline from #1656.
- New `onScopeOverride` callback on `CompileLessonCallbacks` wired to a `writeScopeOverrideTelemetry` closure in CLI `compile.ts` that records `type: 'scope-override'` entries to `.totem/temp/telemetry.jsonl`. Cloud-compile path also wired.
- Author intent supreme: source-declared Scope overrides the LLM's emission AND the #1626 test-contract auto-include heuristic. The auto-include path stays active only when the lesson omits Scope.

Compile pipeline failure mode shifts from "silent drop" to "deterministic override + telemetry on divergence." Strict-fail compile gate is deferred to a follow-up if telemetry reveals persistent LLM drift.
