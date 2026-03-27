## Lesson — Use maxRetries and retryDelay in fs.rmSync to prevent

**Tags:** node, fs, windows, testing

Use maxRetries and retryDelay in fs.rmSync to prevent ENOTEMPTY flakes on Windows caused by filesystem locks or race conditions during rapid test teardowns.
