## Lesson — Use a shared glob matching implementation across CLI

**Tags:** ci, consistency, globs

Use a shared glob matching implementation across CLI and core packages to ensure that ignore patterns behave identically in all environments. This prevents "CI noise" where submodule changes or ignored files trigger false failures due to divergent path-matching logic.
