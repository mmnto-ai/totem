## Lesson — A fixture meant to prove "this code uses core's predicate

**Tags:** testing, fixtures, discriminating-test, falsification-leg, s6-regeneration

**Applies-to:** boundary-test

A fixture meant to prove "this code uses core's predicate, not a look-alike keyed on another field" must be UNEVEN so the look-alike's answer differs: rows where the two keys agree prove nothing. The first fixture for the docs transforms' default record-path predicate (one legacy row, one row with examples, one row with only curation) rendered "2 of 3" under core's examples-keyed predicate AND under a curation-keyed look-alike; falsification read 3 (F17) on mmnto-ai/totem#3062 measured the identity. The fold used two rows with a non-empty examples list and one with only curation: "2 of 4" by core's key, "3 of 4" by curation, "1 of 4" by any-record-field. Fixture rows must also satisfy the schema (examples has a minimum of one entry), or the fixture tests a shape the loader refuses.

**Source:** mcp (added at 2026-10-13T06:58:13.753Z)
