## Lesson — Retaining redundant filtering at both the diff-block

**Tags:** architecture, patterns, performance

Retaining redundant filtering at both the diff-block and line-extraction levels serves as a low-cost defense-in-depth strategy. This "belt-and-suspenders" approach prevents regressions during refactoring or hardening phases without significant performance impact.
