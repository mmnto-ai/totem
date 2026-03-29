## Lesson — When redirecting stdio to a file for a detached process

**Tags:** node, fs, spawn

When redirecting stdio to a file for a detached process using fs.openSync, the file descriptor must be explicitly closed in the parent process to prevent resource leaks.
