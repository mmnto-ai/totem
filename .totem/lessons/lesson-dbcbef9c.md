## Lesson — Strip whitespace from command substitutions safely

**Tags:** shell, posix, compatibility
**Scope:** tools/post-merge, packages/cli/src/commands/install-hooks.ts

`wc -c` output is padded with leading spaces on BSD/macOS, and whether a given POSIX sh's `test` accepts padded integers for `-gt` is implementation territory (our CI legs never combine padded-wc with dash — exactly where a defect would hide untested). Wrapping the substitution in arithmetic expansion `$(( ... ))` normalizes it to a clean integer on every POSIX shell and eliminates the class regardless.
