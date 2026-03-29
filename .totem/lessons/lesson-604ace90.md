## Lesson — Auto-formatters must ignore files whose integrity

**Tags:** dx, ci, formatting

Auto-formatters must ignore files whose integrity is verified by hashes, as reformatting changes the file content and invalidates manifest attestation in CI.
