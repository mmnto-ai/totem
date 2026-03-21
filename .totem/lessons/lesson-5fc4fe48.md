## Lesson — Filter rule sets by their execution engine (e.g., AST-grep

**Tags:** performance, architecture

Filter rule sets by their execution engine (e.g., AST-grep vs regex) before passing them to specialized executors. This avoids unnecessary overhead and prevents logic errors, as different engines may expect different properties or use placeholder values for irrelevant fields.
