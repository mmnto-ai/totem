## Lesson — Apply ignore patterns to explicit diffs

**Tags:** git, architecture, filtering
**Scope:** packages/cli/src/git.ts

Global ignore patterns for generated or vendor files should apply even to explicit diff ranges to maintain repository hygiene across all review sources.
