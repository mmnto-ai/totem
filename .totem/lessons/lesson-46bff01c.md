## Lesson — Namespace local draft paths by repository

**Tags:** fs, caching
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When saving local files derived from external IDs, include the repository namespace in the filename. This prevents collisions when the same ID exists across different repositories. Key the stem on the repository the INPUT named — the lower-cased repository joined with `_` before sanitizing, so `a-b/c` and `a/b-c` get different stems — and keep `<number>.md` for a bare number, whatever repository the adapter resolved it in. The stem is not unique in general (a repository name may contain `_`, an Enterprise Managed User's handle does, and punctuation sanitizes to dashes), so the prose claim is bounded and the override flag is named (mmnto-ai/totem#2965, CodeRabbit 4107424695 and leg 3).
