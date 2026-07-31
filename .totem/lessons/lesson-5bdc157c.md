## Lesson — Bound Date inputs in Zod refinements

**Tags:** zod, validation, security
**Scope:** packages/core/src/qbd/**/*.ts

Zod refinements do not trap runtime errors like RangeError from invalid Date conversions. Forged or out-of-range inputs must be explicitly bounded before Date instantiation to prevent crashing the entire parser.
