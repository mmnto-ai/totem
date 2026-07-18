---
'@mmnto/cli': patch
---

`totem doctor --strict=warn` — a strict-warn tier for the doctor gate. Warn-class diagnostics (Compiled Rules, Git Hooks, Index wiring) now exit non-zero alongside fail-class ones, giving CI and agents a single machine-checkable all-wiring oracle instead of parsing prose. Bare `--strict` is unchanged (fail-class only), and `--strict=<unknown>` fails loud with the valid tier list. Closes #2385.
