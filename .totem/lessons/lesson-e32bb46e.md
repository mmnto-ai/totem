## Lesson — Align local linting with CI steps

**Tags:** ci, eslint, dx

A local pre-push gate can miss import-sorting failures if it skips the workspace-level ESLint step executed by CI (`pnpm lint` is distinct from `totem lint`). Ensure local validation runs the exact same linting suite as the remote pipeline — including on inline fix-round commits, not only on the initial build.
