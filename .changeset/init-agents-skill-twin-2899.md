---
'@mmnto/cli': patch
---

`totem init` now writes each distributed skill to its `.agents/skills/<name>/SKILL.md` twin as well as `.claude/skills/<name>/SKILL.md`, whenever the repository carries an `.agents/` directory, and the install summary lists both rows; a repository without that directory gets one summary line saying the twins were not written (mmnto-ai/totem#2899). Before this, init refreshed only the `.claude` copy and left a consumer's twin on the previous text — two liquid-city syncs found the drift by `cmp` and hand-copied the twin forward. The skill loop is now the exported `distributeClaudeSkills(cwd, opts)` with `SKILL_TWIN_ROOTS`, so the behaviour is testable against a temp directory: a stale marker-bearing twin is refreshed to the same bytes as the `.claude` copy, a repository without `.agents/` gets no twin, and a second run reports every twin as unchanged.
