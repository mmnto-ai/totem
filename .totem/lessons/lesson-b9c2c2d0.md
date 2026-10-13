## Lesson — A discriminator keyed on the ABSENCE of a marker (ruleClass

**Tags:** lint, record-path, discriminator, falsification-leg, trap, s6-regeneration

**Applies-to:** boundary

A discriminator keyed on the ABSENCE of a marker (ruleClass == null read as "legacy") silently widens the day a new un-stamped class appears; key on the positive predicate of the class you mean and twin every "does not mislabel X" test for each class. After the S6 regeneration every record-built row was un-stamped too (D3 (a)), so totem lint's hasFrozenLessonAdvisory treated a warning from a record regex rule as a frozen lesson and printed the "sensed-not-enforced under the rule-compilation freeze" note about a record-served rule, in the text note and the SARIF summary. Found by falsification read 2 (F11) on mmnto-ai/totem#3062; folded by also requiring !isRecordPathRule(rule) from core through the file's dynamic barrel import, a twin of the minted-advisory test that fails on the pre-fix code, and a patch changeset. A record row in such a test needs explicit fileGlobs: recordScopeMatchesFile reads an absent list as "nothing", unlike the legacy "no globs means every file" default.

**Source:** mcp (added at 2026-10-13T06:58:11.989Z)
