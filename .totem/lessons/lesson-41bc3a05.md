## Lesson — Avoid relying on the test runner's environment to determine

**Tags:** testing, cli, tty

Avoid relying on the test runner's environment to determine interactive mode, as this causes flakiness between CI and local terminals. Use an injectable option to override TTY detection so that non-interactive error paths can be tested deterministically.
