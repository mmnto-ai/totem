## Lesson — When executing child processes via execSync with stdio:

**Tags:** nodejs, cli, ux

When executing child processes via `execSync` with `stdio: 'inherit'`, the child process's output is already streamed directly to the terminal. Adding explicit error messages in the parent's `catch` block often results in duplicate log output, cluttering the user's view of the actual failure reasons.
