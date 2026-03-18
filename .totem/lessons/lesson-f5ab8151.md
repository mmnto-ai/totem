## Lesson — Using stored metadata as a fallback (e.g., current ??

**Tags:** validation, configuration, state-management

Using stored metadata as a fallback (e.g., `current ?? stored`) during verification can mask mismatches if the library's internal defaults change between versions. Verification logic must compare the current effective configuration against the stored state to detect when an index requires a rebuild.
