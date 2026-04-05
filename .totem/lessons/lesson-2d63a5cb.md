## Lesson — Ensure resilient feature detection

**Tags:** cli, initialization, error-handling
**Scope:** packages/cli/src/commands/init-detect.ts

Feature detection during initialization must handle missing dependencies or environment errors silently. Falling back to a safe default state is preferable to crashing the onboarding process when optional tools like Ollama are missing.
