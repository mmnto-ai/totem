## Lesson — Allow inline literals for test timeouts

**Tags:** dx, styleguide, testing
**Scope:** packages/cli/src/**/*.test.ts

The 'no magic numbers' rule does not apply to test infrastructure configuration like timeouts; keeping them inline avoids unnecessary indirection while the key name provides sufficient documentation.
