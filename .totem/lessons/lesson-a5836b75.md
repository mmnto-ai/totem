## Lesson — Judge a data-table test suite against mutant tables

**Tags:** testing, validation, whitelist
**Scope:** packages/cli/src/commands/**/*.test.ts

A test suite over a static table is judged by running its assertions against mutant tables — the pre-change table, a row retyped, a row reordered, a twin row added, a name misspelled: every mutant should fail at least one test. An assertion that passes on every mutant pins nothing; an inequality between the digests of two different arrays is one, because it holds by construction (mmnto-ai/totem#2980, leg finding b2r-F3; mmnto-ai/totem#2984, six mutants each caught by at least two tests).
