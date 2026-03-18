## Lesson — For CLI tools reading a small number of local files,

**Tags:** nodejs, cli, fs

For CLI tools reading a small number of local files, synchronous file system APIs are often preferable to asynchronous ones. This approach minimizes code complexity and avoids the overhead of promise management in contexts where blocking the event loop has no measurable impact on performance.
