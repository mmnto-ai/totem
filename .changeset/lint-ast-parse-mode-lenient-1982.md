---
'@mmnto/cli': minor
'@mmnto/totem': patch
---

feat(cli): `--ast-parse-mode lenient` operator escape for AST parse failures ([mmnto-ai/totem#1982](https://github.com/mmnto-ai/totem/issues/1982))

Closes [mmnto-ai/totem#1982](https://github.com/mmnto-ai/totem/issues/1982). Mirrors the existing `--timeout-mode lenient` precedent at `packages/cli/src/commands/lint.ts` for a different failure class: AST parse errors that currently abort the entire lint run (e.g. `ast-grep batch parse failed: rust is not supported in napi` on Windows).

Empirical trigger: `mmnto-ai/liquid-city#348` (Bevy 0.14 → 0.18.1) hit the napi-unsupported-Rust parse failure on every changed Rust file, blocking pre-push with no audited escape route (`--no-verify` violates AGENTS.md spirit).

## What ships

**New CLI flag:**

```bash
totem lint --ast-parse-mode lenient
```

**Env var equivalent (session-level escape, usable in pre-push hooks):**

```bash
TOTEM_LINT_AST_PARSE_MODE=lenient totem lint
```

Precedence: CLI flag > env var > default `'strict'`.

**`'lenient'`** captures the parse failure into a new `AstParseFailureOutcome` array, logs a warning naming the affected language, sets `astViolations = []`, and continues with regex results. **`'strict'`** (default) preserves the current hard-fail behavior.

**Diagnostic hint upgrade in `@mmnto/totem`:** `AST_GREP_HINT` (surfaced via every `TotemParseError`'s `recoveryHint`) now names the new escape route and cross-refs [mmnto-ai/totem#1786](https://github.com/mmnto-ai/totem/issues/1786) for the durable per-file degrade fix.

## Semantic asymmetry vs `--timeout-mode lenient` (deliberately documented)

| Flag                       | Skip granularity                                         | Why                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--timeout-mode lenient`   | **per-rule** (per rule-file pair that times out)         | Bounded evaluator captures timeouts in-loop without throwing                                                                                                                      |
| `--ast-parse-mode lenient` | **run-wide** (skip ALL AST rules on first parse failure) | AST batch parser raises `TotemParseError` that escapes the per-file loop in core; per-file degrade is [mmnto-ai/totem#1786](https://github.com/mmnto-ai/totem/issues/1786)'s lane |

For the current trigger (napi unsupported language), per-file vs run-wide is operationally equivalent — every Rust file fails parse the same way. The asymmetry matters when future mixed-language scenarios surface (e.g. Python parses, Rust doesn't); that's `#1786`'s design space, not this scope.

## Telemetry / programmatic access

`runCompiledRules()` now returns `astParseFailures: AstParseFailureOutcome[]` alongside `regexTimeouts`:

```typescript
interface AstParseFailureOutcome {
  file: string; // '*' (run-wide; per-file granularity is #1786)
  language: string; // 'rust' or 'unknown' if not parseable from msg
  message: string; // first 200 chars of sanitized parser-error text
  mode: 'lenient';
}
```

Parser-error text is sanitized via the canonical `sanitizeForTerminal()` helper from `@mmnto/totem` core (`packages/core/src/terminal-sanitize.ts`) before logging or persisting. Strips CSI/ANSI escapes, C0 controls (including bare CR per CR [mmnto-ai/totem#1739](https://github.com/mmnto-ai/totem/issues/1739) R3 — cursor-rewind spoofing), and C1 controls (`\x80-\x9F`). Preserves TAB and LF. Defends against terminal injection from ast-grep's parsed-content snippets.
