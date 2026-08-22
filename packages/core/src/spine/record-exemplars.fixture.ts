// ─── Prop 310's two spec exemplars, transcribed ONCE ─────────────────────────
//
// § Design 4's coherent record and § Design 8's `requires:` record are the
// spec's own worked examples, and § Design 14's normativity flip makes them
// normative: an implementation that cannot round-trip them is the bug. Both the
// lowering suite and the runtime suite exercise them, so they are single-homed
// here rather than transcribed twice (Tenet 20 — two hand-maintained copies of a
// normative fixture is how one silently drifts from the spec).
//
// NOT a test file (`*.fixture.ts` is outside vitest's `src/**\/*.test.ts`
// include) and deliberately NOT barrel-exported: this is conformance material,
// not public API. It is a plain module rather than a test-file export so that
// importing it cannot re-register another suite's `describe` blocks.
//
// Comments are stripped and YAML block scalars are resolved to their parsed
// values, since these are the PARSED shapes; slice 1's suite carries the same
// two records in their literal YAML form.

/** Prop 310 § Design 4's exemplar — a compound ast-grep record with every optional block. */
export function design4ExemplarRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'error',
    message: 'Catch blocks must re-throw or route the error — fail-open catch is banned.',
    recoveryHint: 'Re-throw after logging, or route to the error channel.',
    target: {
      type: 'ast-grep',
      language: 'typescript',
      rule: { kind: 'catch_clause', not: { has: { kind: 'throw_statement', stopBy: 'end' } } },
      scope: { fileGlobs: ['packages/**/*.ts'], excludeGlobs: ['**/*.test.ts'] },
    },
    examples: [
      {
        bad: 'try { risky() } catch (e) { log(e) }',
        good: 'try { risky() } catch (e) { log(e); throw e }',
      },
    ],
    curation: {
      sourceLesson: 'lesson-77c5e668389fb1a2',
      curatedBy: 'strategy-gemini',
      curatedAt: '2026-06-15T14:00:00Z',
      baseline5Phase: 3,
    },
    verification_shadow: { type: 'rego', source: 'package totem.rules.example\n' },
  };
}

/** Prop 310 § Design 8's exemplar — the absence / must-contain shape (the census's rule (c)). */
export function design8ExemplarRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'warning',
    message: 'git output-consuming commands must pin LC_ALL=C on the same line.',
    target: {
      type: 'regex',
      pattern: '\\bgit\\s+(log|diff|status)\\b',
      scope: { fileGlobs: ['**/*.sh', '**/*.cjs'] },
    },
    requires: { pattern: 'LC_ALL=C', scope: 'line' },
    examples: [{ bad: 'git log --oneline', good: 'LC_ALL=C git log --oneline' }],
  };
}
