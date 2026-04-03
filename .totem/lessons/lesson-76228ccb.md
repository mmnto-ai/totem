## Lesson — Filter diff candidates before selection

**Tags:** git, logic
**Scope:** packages/cli/src/commands/extract.ts

When cascading through git diff sources (staged, working tree, unpushed), filter out lockfiles and ignored files before selecting a source. Selecting the first non-empty raw diff can cause lockfile-only changes to short-circuit the logic and prevent the tool from finding meaningful code changes in later fallbacks.
