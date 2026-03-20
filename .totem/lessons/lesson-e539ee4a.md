## Lesson — Avoid hardcoding "magic numbers" or specific counts

**Tags:** git, automation, maintainability

Avoid hardcoding "magic numbers" or specific counts when automating file reverts in skills. Utilizing `git checkout HEAD` to restore a file to its last committed state is more robust than relying on static metrics that will inevitably drift as the project evolves.
