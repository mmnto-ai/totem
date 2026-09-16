## Lesson — Write files atomically with converged terminators

**Tags:** fs, io, formatting
**Scope:** packages/cli/**/*.ts

Always write updates to a temporary file before renaming to ensure atomic operations. Additionally, validate UTF-8 encoding and converge mixed line terminators to match the rest of the file to prevent diff noise and corruption.
