## Lesson — Escape back-references in template substitution

**Tags:** javascript, security, templating
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Dynamic strings containing symbols like $& or $1 trigger special behavior in String.prototype.replace; use a replacer function to avoid accidental expansion.
