## Lesson — Submodule pointer updates, such as those in .strategy

**Tags:** ci, git, submodules

Submodule pointer updates, such as those in `.strategy` directories, can trigger false positives during automated diff analysis or linting. Pre-filtering the git diff with ignore patterns ensures CI tools only react to actual code changes rather than metadata updates.
