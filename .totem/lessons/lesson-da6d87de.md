## Lesson — Hash dirs with git ls-files for cross-platform stability

**Tags:** git, ci, cross-platform

Hashing directory contents via `git ls-files -s` and `git hash-object` provides immunity to CRLF/LF line-ending drift across Windows, Linux, and macOS. This creates a more reliable cryptographic lock for CI fixtures than standard filesystem-based hashing.
