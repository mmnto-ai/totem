## Lesson — Defensive guards in multi-source batch loops should use

**Tags:** error-handling, resilience, logging

Defensive guards in multi-source batch loops should use warnings rather than throwing or silently swallowing errors. This informs the user of partial failures, such as a misconfigured or inaccessible repository, while allowing the command to proceed with available data.
