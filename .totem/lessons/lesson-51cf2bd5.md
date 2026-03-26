## Lesson — Always reset module-level state like custom warning

**Tags:** testing, javascript

Always reset module-level state like custom warning handlers in `afterEach` blocks to prevent state leakage that can cause unpredictable failures in subsequent tests.
