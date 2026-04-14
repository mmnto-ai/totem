# Compound ast-grep validation spike findings

**Ticket:** mmnto-ai/totem#1406
**Epic:** mmnto-ai/totem-strategy#81
**Proposal:** [.strategy/proposals/active/226-compound-ast-grep-rules.md](../../../../.strategy/proposals/active/226-compound-ast-grep-rules.md)
**Library under test:** `@ast-grep/napi@0.42.0`
**Harness:** [compound.spike.test.ts](compound.spike.test.ts) (9 tests, 244 ms)

## Verdict

**Proposal 226 is viable as specified. No runtime blockers.** The engine runtime is already polymorphic over `string | NapiConfig` via `findAll()`. The real work in tickets #1407 and #1408 is schema tightening, compiler-prompt guidance around one empirical sharp edge, and a few hygiene fixes.

## Capability matrix

| Capability                                                                  | Result           |
| --------------------------------------------------------------------------- | ---------------- |
| `findAll()` accepts `NapiConfig` objects as-is, no wrapping                 | Yes              |
| `inside` combinator via `kind:` target                                      | Yes              |
| `inside` combinator via `pattern:` target                                   | **No (see G-3)** |
| `has` combinator (tested: empty-catch detection)                            | Yes              |
| `not` combinator (tested: suppress-if-inside-import)                        | Yes              |
| Invalid schema throws catchable `Error`, process survives                   | Yes              |
| Compound-match `range()` points at the outer matched node, not a descendant | Yes              |
| Outer-node range spans full multi-line node                                 | Yes              |

Exact napi error text for an unknown kind (captured to stderr during test 9):

> `` `rule` is not configured correctly. `` with chain including `Rule contains invalid kind matcher.`

## NapiConfig shape

Source: `packages/core/node_modules/@ast-grep/napi/types/config.d.ts` and `rule.d.ts`.

```ts
interface NapiConfig {
  rule: Rule;
  constraints?: Record<string, Rule>;
  language?: FrontEndLanguage;
  utils?: Record<string, Rule>;
}

interface Rule {
  pattern?: string | { context: string; selector: string };
  kind?: string;
  range?: RangeConfig;
  regex?: string;
  nthChild?: number | { position: number; reverse?: boolean };
  inside?: Relation;
  has?: Relation;
  precedes?: Relation;
  follows?: Relation;
  all?: Rule[];
  any?: Rule[];
  not?: Rule;
  matches?: string | UtilityCall;
}

interface Relation extends Rule {
  stopBy?: 'neighbor' | 'end' | Rule;
  field?: string;
}
```

`findAll` signature (sgnode.d.ts:69-71) accepts `string | number | NapiConfig` directly. No adapter layer needed.

## Gaps for #1407 (schema)

### G-1. Tighten `astGrepPattern` Zod schema

**Today:** `compiler-schema.ts:19` and `:94` define `astGrepPattern` as `z.record(z.unknown())`. This passes rules with typoed combinator names (e.g., `{ inisde: ... }`) through the compile gate, and they fail silently at runtime.

**Change:** Replace the `z.record(z.unknown())` branch with a structural `NapiConfigSchema` mirroring the interface above, using `z.lazy()` for the recursive combinators (`all`, `any`, `not`, `inside`, `has`, `precedes`, `follows`). Enforce the `rule` key at the schema level to match the existing runtime guard at `compile-lesson.ts:104-107`.

### G-2. Teach `isSelfSuppressing` to walk compound rules

**Today:** `compile-lesson.ts:217-225` + `:260-263` stringifies the whole pattern object with `JSON.stringify` and runs a string check for `totem-ignore` / `totem-context` markers.

**Change:** Add an object-aware walker that recurses the Rule tree and checks every `pattern` / `regex` / `kind` leaf. Keep the string-stringify fallback for regex rules; add the object walker for ast-grep rules.

### G-4. Trim trailing semicolons on declaration-pattern text

**Today:** `SgNode.text()` includes trailing `;` on declaration patterns. Harness documents this at `compound.spike.test.ts:123-127`.

**Change:** If #1407 adds test-generation that round-trips matched text into regex, trim trailing `;` first. Zero impact on line-based matching in `executeQuery`.

## Gaps for #1408 (engine)

### G-5. Round-trip test coverage for compound rules

**Today:** `rule-engine.ts:415` casts `rule.astGrepPattern as AstGrepRule` with no runtime shape check and no rule-engine-level test covering a compound-rule round-trip through `compiled-rules.json`.

**Change:** One regression test per combinator (`inside`, `has`, `not`) that exercises the full load-to-match path. Hash stability on the compound-rule JSON shape is already covered by `buildCompiledRule`'s existing `typeof pattern === 'string' ? pattern : JSON.stringify(pattern)` dual path at `compile-lesson.ts:260-263`.

### G-6. Annotate the outer-node range contract

**Today:** `ast-grep-query.ts:53-73` has no doc comment noting that compound-rule matches use the outer node's range. This is a load-bearing implicit contract.

**Change:** Add a block comment pointing at the spike's position-tracking assertion (`compound.spike.test.ts:197-242`) and pin the contract with a rule-engine-level regression test.

### G-7. Per-rule try/catch inside the batch loop

**Today:** `matchAstGrepPatternsBatch` at `ast-grep-query.ts:121-128` wraps the whole batch in a single try/catch. One malformed compound rule blast-radiuses the whole file's ast-grep pass.

**Change:** Move each `findAll` call into its own try/catch inside `executeQuery`. Route individual failures through `onRuleEvent?.('suppress', ..., { reason: 'failure-compile' })` so `totem doctor` can surface them instead of crashing the file pass.

### G-8. Re-export `AstGrepRule` from the package index

**Today:** The `AstGrepRule` alias at `ast-grep-query.ts:9` is not re-exported from `packages/core/src/index.ts`. External rule-pack authors would have to reach into `dist/` to reach the type.

**Change:** Add the re-export during #1408 so pack authors have a public seam.

## Gaps for #1409 (compiler prompt)

### G-3. Steer Sonnet away from `inside: { pattern: ... }`

**Today:** The compile prompt (CLI package, outside spike scope) does not steer Sonnet away from the silent-no-match `inside: { pattern: ... }` shape. Test 8 in the harness (`compound.spike.test.ts:246-264`) pins this empirically: the exact pattern `'for ($INIT; $COND; $STEP) { $$$ }'` parses in isolation, passes `validateAstGrepPattern`, passes the compile gate, and returns zero matches at runtime.

**Change:** Add prompt guidance. For `inside` / `has` outer targets, prefer `kind:`. Reserve `pattern:` for the target (matched) node. Pin an allow-list of common outer `kind:` values: `for_statement`, `while_statement`, `try_statement`, `catch_clause`, `function_declaration`, `class_declaration`, `method_definition`, `import_statement`, `export_statement`.

**Defense in depth:** If #1407 also adds a `validateAstGrepPattern` dry-run smoke test (run each compound rule against a minimal TS snippet at compile time and fail the rule if zero matches against its own example code), G-3 becomes a belt-and-suspenders fix rather than a pure prompt problem.

## Blockers

None. The one sharp edge (G-3) is a prompt-and-validation issue, not a runtime block. The underlying `inside` combinator works reliably when fed a `kind:` target.

## Test status

```
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    244 ms
```

Run with `pnpm --filter @mmnto/totem test -- compound.spike`.

## Files changed

- `packages/core/spikes/compound-ast-grep/compound.spike.test.ts` (new, 345 lines)
- `packages/core/spikes/compound-ast-grep/findings.md` (this file)
- `packages/core/vitest.config.ts` (added `'spikes/**/*.spike.test.ts'` to `test.include`)

No production code modified.
