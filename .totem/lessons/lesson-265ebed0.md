## Lesson — The eligibility predicate keys on the pair; one name under one engine is the table's policy

**Tags:** whitelist, validation, architecture
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

`evaluateStructuralEligibility` matches on BOTH the engine and the class, so a class name listed under two engines would be two pairs, each with exactly one match, and both would read decidable. What keeps a name under one engine is the table's policy, not the predicate: rule 2 keeps a prose-token class off regex, and the whitelist test pins class-name uniqueness across the table. The load-time guard refuses only a DUPLICATE pair. A comment that calls a two-engine class "ambiguous" misdescribes the shipped code (mmnto-ai/totem#2980, corrected on the scorer's finding).
