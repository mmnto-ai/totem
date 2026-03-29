## Lesson — Naive substring matching like includes('dir/') can trigger

**Tags:** filesystem, regex, path

Naive substring matching like includes('dir/') can trigger false positives on similarly named path segments; use regex boundaries or path normalization to ensure logic only applies to intended directories.
