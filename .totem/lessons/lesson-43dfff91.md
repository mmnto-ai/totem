## Lesson — Assert directory absence for early-fail tests

**Tags:** testing, fs, integrity
**Scope:** packages/cli/src/commands/*.test.ts

Asserting the absence of a final artifact is a weak test for early-fail gates. Tests should verify that the target directory or early-stage files were never created to confirm the atomicity of the failure.
