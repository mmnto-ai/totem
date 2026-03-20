## Lesson — Using [val].flat().filter(Boolean) to normalize inputs

**Tags:** typescript, type-safety, refactoring

Using `[val].flat().filter(Boolean)` to normalize inputs often loses TypeScript's type narrowing, resulting in generic arrays that require manual casting. Explicit ternary checks for arrays and truthiness preserve specific types like `string[]` more cleanly and safely.
