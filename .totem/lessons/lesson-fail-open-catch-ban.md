## Lesson — Ban fail-open catch blocks that skip re-throwing

**Tags:** tenet-4, fail-loud, ast-grep-compound, governance
**Engine:** ast-grep
**Scope:** packages/**/*.ts, !**/*.test.ts, !**/*.spec.ts
**Severity:** error
**Pattern:**

```yaml
rule:
  kind: catch_clause
  not:
    has:
      kind: throw_statement
      stopBy: end
```

**Message:** Catch clause swallows the error without re-throwing. Tenet 4 (Fail Loud, Never Drift) forbids silent degradation. Either rethrow with `throw err` / `throw new Error(..., { cause: err })`, or if the catch is genuinely a best-effort cleanup (temp file unlink, socket close, etc.) add `// totem-context: intentional cleanup` above the try/catch to document the exception.

Tenet 4 (Fail Loud, Never Drift) forbids catching an error and continuing silently. A `catch` clause that contains no `throw_statement` anywhere in its body quietly swallows the failure, corrupting the upstream signal that the sensor-based architecture depends on. The `not.has.throw_statement` combinator with `stopBy: end` walks the entire catch body subtree so that rethrows nested inside `if` / `switch` / helper-call paths still pass.

**The deliberate escape hatch:** a small set of catches are legitimately swallow-on-failure because the work inside is inherently best-effort (unlinking a temp file that may already be gone, closing a handle that may already be closed). For those sites, add `// totem-context: intentional cleanup` above the `try` block. Never weaken the rule; document the exception at the call site.

### Bad Example

```ts
try {
  fs.unlinkSync(tempPath);
} catch {
  // swallowed — no throw, no log, no explicit suppression
}
```

### Good Example

```ts
try {
  await doWork();
} catch (err) {
  throw new Error(`doWork failed: ${String(err)}`, { cause: err });
}
```

## Why this needs to be compound

A flat ast-grep pattern cannot express "catch clause whose body does not contain a throw_statement anywhere in its descendant tree." The combinator `not: { has: { kind: throw_statement, stopBy: end } }` anchored on `kind: catch_clause` encodes exactly that tree-relationship. This is one of the motivating use cases for compound ast-grep rule support (ADR-087 / Proposal 226).

**Source:** Pre-1.15.0 deep review (mmnto/totem#1421). Gemini's Repomix teardown flagged multiple fail-open `catch` sites in `packages/core/src/sys/git.ts` and `rule-engine.ts` (tracked in mmnto/totem#1440 and mmnto/totem#1442). First production compound rule shipped via the new Pipeline 1 yaml-fence path.
