## Lesson — Include rule context in skipped metadata

**Tags:** testing, cli, metadata
**Scope:** packages/core/src/rule-tester.ts, packages/cli/src/commands/test-rules.ts

Skipped items should carry identifying metadata like hashes and headings to enable accurate downstream filtering. This ensures CLI warnings remain relevant to the user's active filter instead of cluttering the output with unrelated stubs.
