## Lesson — While using shell: true fixes Windows ENOENT errors

**Tags:** windows, node.js, security

While using `shell: true` fixes Windows ENOENT errors for command shims, manually appending `.cmd` to the executable is a safer pattern that avoids shell injection risks and process overhead.
