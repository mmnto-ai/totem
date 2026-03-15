## Lesson — Hooks designed to block agent actions, such as shield gates

**Tags:** nodejs, devtools, architecture

Hooks designed to block agent actions, such as shield gates for git operations, must use synchronous execution (e.g., `execSync`) to prevent the agent from proceeding before the check completes. Using asynchronous patterns in these specific triggers can lead to race conditions where the prohibited action occurs while the validation is still running.
