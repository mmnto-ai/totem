## Lesson — Avoid hardcoding .git/hooks paths as repositories may use

**Tags:** git, portability

Avoid hardcoding `.git/hooks` paths as repositories may use custom `core.hooksPath` configurations; use `git rev-parse --git-path hooks` for reliable resolution.
