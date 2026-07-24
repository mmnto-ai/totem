## Lesson — Induce EISDIR by replacing a file with a directory

**Tags:** testing, windows, portability
**Scope:** packages/**/*.test.ts

Portable induced I/O fault for tests: replace the target file with a directory so reads fail with EISDIR on both win32 and posix. Permission-bit tricks such as chmod do not port to Windows; a directory in place of a file fails readFileSync identically everywhere, giving induced-failure tests a cross-platform fault primitive.
