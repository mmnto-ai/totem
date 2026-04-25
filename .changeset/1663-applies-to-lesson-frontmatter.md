---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

feat(core+mcp): `applies-to` lesson frontmatter for role-of-code citation accuracy (#1663)

Strategy item 020 substrate. Lesson frontmatter gains an `applies-to:` field carrying a closed role taxonomy (`mutator`, `boundary`, `aggregator`, `hot-path`, `boundary-test`, `infrastructure`, `presentation`, `any`) so downstream bot reviewers can filter lessons by role match instead of grep-by-topic heuristics.

- New public exports from `@mmnto/totem`: `LessonRole`, `LessonRoleSchema`, `filterLessonsByRole`, `LessonWithAppliesTo`.
- YAML and prose wire formats both supported. YAML accepts list (`applies-to: [mutator, boundary]`) and scalar (`applies-to: mutator`) forms; prose form is `**Applies-to:** mutator, boundary`. Mixed-case input is lowercased; empty arrays normalize to `['any']`; missing field defaults to `['any']`.
- `mcp__totem-dev__add_lesson` gains an optional `applies_to` argument (snake_case at the MCP boundary, kebab-case in the on-disk frontmatter per item 020).
- Pure `filterLessonsByRole(lessons, targetRole?)` utility exported for downstream consumers; `targetRole` undefined returns input unchanged, otherwise keeps lessons whose `appliesTo` includes the target OR `'any'`.
- Backwards-compat: existing 1,159 lessons continue to parse with `appliesTo: ['any']` deterministically; no migration required.

Bot-prompt integration and the function-role classifier are out of scope for this PR (see follow-up tickets at PR merge). Item 020 is the Proposal 248 (`mmnto-ai/totem-strategy#136`) substrate prereq for per-bot operations packs.
