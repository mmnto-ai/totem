## Lesson — Guard parsers against hook format changes

**Tags:** testing, git-hooks, clean-code
**Scope:** packages/cli/src/commands/install-hooks.test.ts

When parsing multi-block git hooks in tests, use named constants for expected block counts to make termination logic explicit and prevent brittle failures as the hook format evolves.
