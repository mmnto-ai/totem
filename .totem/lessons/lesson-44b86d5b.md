## Lesson — When testing automated shell script modifications, assert

**Tags:** testing, shell, git-hooks

When testing automated shell script modifications, assert the full block content and verify balanced `if/fi` pairs. This prevents partial or broken script upgrades that could lead to silent failures in environments like Git hooks.
