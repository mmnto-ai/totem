## Lesson — Use byte-level binary size checks

**Tags:** shell, ci, build
**Scope:** packages/cli/build/compile-lite.sh

Comparing file sizes in megabytes via integer division can allow binaries near the threshold to bypass limits; use byte-to-byte comparisons for accurate enforcement.
