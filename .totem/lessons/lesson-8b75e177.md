## Lesson — Always close file descriptors in finally blocks

**Tags:** node, fs, performance

Always close file descriptors in finally blocks when spawning detached child processes to prevent resource leaks if the spawn operation itself throws an error.
