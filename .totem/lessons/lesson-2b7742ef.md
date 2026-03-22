## Lesson — Use semantic checks, such as verifying the presence

**Tags:** clean-code, logic, robustness

Use semantic checks, such as verifying the presence of specific object types, instead of checking array lengths for fallback logic. Hardcoded length checks are fragile and break silently when the number of default or prepended items changes during refactoring.
