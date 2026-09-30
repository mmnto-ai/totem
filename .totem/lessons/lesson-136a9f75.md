## Lesson — Prove a lookahead inert, then keep it verbatim in a migrated record

**Tags:** regex, migration, fidelity
**Scope:** .totem/rules/mig-*.rule.yaml

A negative lookahead is inert when the pattern that must match next already rejects every character the lookahead rejects: `(?!\?)` followed by `\s*:` stands in for nothing, because a question mark satisfies neither whitespace nor the colon. In a fidelity-checked migration an inert construct is kept VERBATIM and proved inert (the argument, a battery of line shapes, a scan of the pinned tree), not removed: removing it is a pattern change the record would have to declare (mmnto-ai/totem#2948, rule `83b86cd7`; the scorer's own re-read of the pattern agreed).
