## Lesson — Use byte-level binary size checks

**Tags:** bash, ci, build
**Scope:** packages/cli/build/compile-lite.sh

When enforcing binary size limits in shell scripts, compare raw byte counts rather than megabyte integers to prevent binaries just under the limit from slipping through due to truncation.
