## Lesson — Ban `export let` declarations (exported module-level mutable state)

**Tags:** tenet-12, determinism, functional-isolation, ast-grep-compound, governance
**Engine:** ast-grep
**Scope:** packages/**/*.ts, !**/*.test.ts, !**/*.spec.ts
**Severity:** error
**Pattern:**

```yaml
rule:
  kind: export_statement
  has:
    kind: lexical_declaration
    pattern: let $NAME = $VALUE
```

**Message:** Exported `let` bindings create cross-module shared mutable state, which breaks functional isolation and makes concurrent or sequenced code paths hard to reason about. Prefer `export const`, or wrap mutation behind an exported function/class that owns the state internally.

`export let` makes a mutable binding reachable from every importer. Any module that imports it can observe different values at different times based on whoever mutated last, and any module can mutate it. That pattern breaks Tenet 12 (Platform of Primitives) because consumers cannot reason about the module's surface as a set of stable primitives — the surface is a shared global.

The related but NARROWER concern in internal module-private `let` bindings (lazy-init caches, singleton accumulators, flags used to gate one-shot behavior) is NOT banned here: those are legitimate when the mutation is confined to one file and the reader/writer pair are well-understood. The rule is deliberately tight to avoid false positives on `let cached = null` / `let initPromise: Promise<T> | null = null` idioms that appear throughout `context.ts`, `search-knowledge.ts`, and similar surfaces.

The compound rule targets `export_statement` nodes that *contain* a `lexical_declaration` matching `let $NAME = $VALUE`. The `has:` combinator walks the export statement's direct subtree to find the `let` binding inside. `const` exports are unaffected because the pattern only matches `let`.

### Bad Example

```ts
export let sharedCounter = 0;
```

### Good Example

```ts
// State stays private; mutation goes through a named API that owns the invariant.
let sharedCounter = 0;
export function incrementCounter(): number {
  sharedCounter += 1;
  return sharedCounter;
}
```

## Why this needs to be compound

A flat pattern `export let $NAME = $VALUE` does not match in ast-grep's TypeScript grammar because `export let` parses as an `export_statement` wrapping a `lexical_declaration`, not as a single flat node. The compound form — anchor on `export_statement`, require a `lexical_declaration` child matching `let` — navigates the parse tree to the correct target. This is a textbook use case for the `has:` combinator.

**Source:** Pre-1.15.0 deep review (mmnto/totem#1421). Gemini's teardown flagged broader module-level mutable state as a category (tracked in #1441 for the rule-engine.ts specific findings) and proposed a three-case AST rule. That rule is tightened here to only the unambiguous "exported let" variant per the Option C guidance from the deep review thread. Zero current violations in the codebase; rule ships as forward protection ahead of 1.15.0 Pack Distribution, where third-party packs might introduce this pattern. The broader rule-engine.ts concurrency concern (#1441) requires a runtime refactor, not a static AST rule.
