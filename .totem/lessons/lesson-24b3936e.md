## Lesson — When a test asserts that a sanitizer removed an AUTHORED

**Tags:** testing, terminal, sanitization, ansi, environment-dependent, trap

When a test asserts that a sanitizer removed an AUTHORED terminal escape from CLI output, the injected needle must be a sequence the CLI's own colouring never emits. The bot-round-1 test on mmnto-ai/totem#2668 injected `ESC[31m` and asserted the raw stderr did not contain it — but `ui`'s `errorColor('FAIL')` emits exactly `ESC[31m` whenever colours are enabled, so the row passed in the build-leg's colour-off environment and failed at the owner gate with colours on, for a reason unrelated to the sanitizer. Chalk/ui emit only SGR sequences (`ESC[…m`); use an erase/cursor CSI such as `ESC[2J` as the authored needle, build it with `String.fromCharCode(27)` (never a raw or `\x1b` literal in source), capture RAW output (a `stripAnsi`'d capture makes the assertion vacuous), and verify the row under `FORCE_COLOR=0`, `FORCE_COLOR=1`, and the default environment before calling it green.

**Source:** mcp (added at 2026-08-22T05:59:27.049Z)
