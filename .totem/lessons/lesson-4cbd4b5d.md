## Lesson — Failing to call clearTimeout after a spawned child process

**Tags:** nodejs, child-process, performance

Failing to call `clearTimeout` after a spawned child process resolves or errors keeps the Node.js event loop active unnecessarily. Always clear the timer within the process 'close' and 'error' listeners to ensure the process can exit promptly and manage resources cleanly.
