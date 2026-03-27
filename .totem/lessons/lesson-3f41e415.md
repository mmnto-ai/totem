## Lesson — Avoid including empty strings in branch whitelists or using

**Tags:** git, shell, security

Avoid including empty strings in branch whitelists or using truthy fallbacks in branch detection logic. These patterns can silently exempt security gates if branch resolution fails, effectively bypassing intended blocks.
