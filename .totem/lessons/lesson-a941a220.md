## Lesson — Allow inline literals for test timeouts

**Tags:** testing, dx, styleguide
**Scope:** packages/cli/src/**/*.test.ts

The general prohibition against magic numbers is waived for test infrastructure configuration like timeouts. Inline literals are preferred here because the 'timeout' key provides sufficient self-documentation.
