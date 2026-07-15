## Lesson — Integration tests for failure sensors must assert

**Tags:** testing, integration-tests, false-green, exit-codes, predictable-robustness

**Applies-to:** boundary-test

Integration tests for failure sensors must assert the intended semantic evidence and reject known wrong-reason errors before asserting the generic nonzero exit code; fixtures must seed all required configuration and enter through the current public command. (Sweep TOTEM-SWEEP-005; anchor: #2320 exhibit, fixed #2326 @ d1e9dc20.)

**Source:** mcp (added at 2026-07-12T03:08:15.634Z)
