## Lesson — Environment variables from the host machine can leak

**Tags:** testing, environment, isolation

Environment variables from the host machine can leak into test runners, causing non-deterministic behavior or false positives. Tests must explicitly clear or mock sensitive environment variables (like API keys) to ensure they are not using host-level configuration.
