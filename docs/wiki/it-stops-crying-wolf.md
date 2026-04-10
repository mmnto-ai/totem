# It Stops Crying Wolf

The graveyard of developer tooling is full of linters that failed because of alert fatigue. If a tool throws 50 warnings about a "vulnerability" that the developer knows is a test fixture, they stop trusting the tool. They add blanket suppression comments or use `--no-verify` to bypass the hook entirely.

Traditional linters are static — they cry wolf until someone spends a weekend manually tuning the configuration. Totem takes a different approach: it observes how rules perform against real code and flags the ones that are getting noisy.

## Context Telemetry

Every compiled rule tracks where its matches land — in actual code, in string literals, in comments, or in regex patterns. This distribution is recorded as `contextCounts` in the rule's metrics.

A rule that fires 100 times but 80 of those matches are inside comments or string literals is not doing useful work. It's generating noise that erodes developer trust.

## The Doctor

The `totem doctor` command analyzes this telemetry and flags rules that have drifted:

```bash
totem doctor
```

If more than 20% of a rule's matches land in non-code contexts (strings, comments, regex literals), doctor flags it as an upgrade candidate with a specific diagnostic:

```
Rule abc123 — "No hardcoded secrets" — 85% non-code matches
  Recommendation: upgrade to AST pattern for precision
```

## Targeted Upgrade

When doctor flags a rule, you can re-run the compiler on just that rule with a precision-targeted prompt:

```bash
totem compile --upgrade <hash>
```

The compiler takes the original lesson, adds the telemetry context ("this rule is matching too many strings/comments"), and generates a more precise AST pattern that targets actual code rather than string content.

## Exemptions

When a developer legitimately needs to bypass a rule (e.g., a test fixture that intentionally contains a banned pattern), they use the `totem-context` annotation:

```typescript
// totem-context: Synthetic test fixture, not a real AWS key.
const key = 'AKIAIOSFODNN7EXAMPLE';
```

This suppresses the specific violation while leaving the rule active for the rest of the codebase.

## The Result

Rules that fire too broadly get flagged and upgraded. Rules that fire accurately stay active. Over time, the linter gets quieter and more precise — it only blocks pushes for violations the team actually cares about.
