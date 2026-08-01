## Lesson — Bound Date inputs in Zod refinements

**Tags:** zod, validation, security
**Scope:** packages/core/src/qbd/**/*.ts

Zod refinements do not trap runtime errors like the RangeError thrown when an out-of-range Date is serialized — new Date(forgedEpoch) yields an Invalid Date silently, and toISOString() then throws. Explicitly bound forged or out-of-range inputs before constructing and serializing the Date to prevent crashing the entire parser.
