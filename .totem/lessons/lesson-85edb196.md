## Lesson — Decline to judge a Windows path that carries a short name

**Tags:** windows, path-resolution, gemini-cli, sensor
**Scope:** packages/cli/src/commands/doctor.ts

Gemini CLI resolves Windows 8.3 short names with a native realpath; the trust row's port does not, and that gap produced one measured false pass. The cure was to refuse the undecidable region rather than half-implement it: on Windows the row skips when this folder's path or ANY trust-file key contains `~`, and says so, at the disclosed cost that one such key makes the row decline for every folder on that machine. In the last read all 5,805 generated cases with a tilde skipped (mmnto-ai/totem#2999).
