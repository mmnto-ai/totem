## Lesson — Read-path schema changes break write-path invariants

**Tags:** architecture, parsing, compiler, schema-evolution, shield

When modifying parsing logic that produces a data structure (lesson hash, AST node, config schema, parsed entity, etc.), audit ALL downstream consumers that read from the data structure BEFORE shipping the change. Read-path schema changes recurringly break write-path invariants in three predictable ways:

1. **Hardcoded heuristics that depended on the old shape.** Pre-change, downstream code may be using a structural coincidence (e.g., `field_a === field_b` because the writer always set them to the same value) as a heuristic for "rule type X". After your change adds a real distinction between field_a and field_b, the heuristic silently misfires and the downstream behavior degrades. Fix: introduce an explicit flag the downstream consumer can check, then update both the producer and the consumer in the same PR.

2. **Format-extension cascades that need cross-helper consistency.** If you extend a format helper to support a new variant (e.g., a new field marker, separator, or syntax), audit every other helper that parses the same format. Inconsistent helpers create silent failure modes where one helper accepts the new variant and a sibling helper rejects it, causing the parsed entity to be partially populated and silently dropped downstream.

3. **Edge cases at the boundaries.** Empty values, line-ending variants (CRLF vs LF), trailing whitespace, and Unicode normalization all need explicit handling at parser boundaries. Returning empty string instead of undefined breaks `?? fallback` chains. Splitting on `\n` instead of `/\r?\n/` silently drops Windows-authored content. These look minor but are the same class of silent-skip bug as the em-dash silent skip resolved by mmnto-ai/totem#1278.

**The Shield AI loop catches some but not all of these.** It catches edge cases at file boundaries (empty values, CRLF) reliably. It catches cross-helper inconsistencies usually but only after a partial fix lands. It does NOT reliably catch heuristic invariants in distant files (e.g., a string-comparison heuristic in a sibling command package). For those, you need explicit code reading: when modifying parsing logic, grep for downstream consumers that read the same field combinations and inspect them for shape assumptions.

**Pattern recurrence**: This pattern has surfaced four times in two consecutive PRs (#1278 enforceHeadingLimit; #1282 doctor.ts manual-rule heuristic, empty-Message edge case, CRLF line endings, alt-form `**Field**:` across helpers). Treat it as a class, not a series of one-offs. Add this lesson as a search-time prompt for any future work that touches lesson-pattern.ts, drift-detector.ts, compile-lesson.ts, or compiler-schema.ts.

**Action checklist when modifying parsing logic:**

- grep for all callers of the function/helper being changed
- grep for all references to the field/property being added or modified
- check downstream code for shape-based heuristics (e.g., `field_a === field_b`, `length === 1`, `typeof x === 'string'`)
- if a new explicit signal replaces an old structural one, add a fallback for backward-compat with old data
- add an edge-case test for: empty value, CRLF input, mixed-form input, partial-population input
- run `totem review` AND read the cascade findings carefully — Shield will catch some but not all of these
