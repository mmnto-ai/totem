## Lesson — When resolving dot-notation paths, validate

**Tags:** security, typescript

When resolving dot-notation paths, validate that intermediate values are objects and use `Object.hasOwn()` to prevent runtime errors on primitives and unauthorized prototype-chain access.
