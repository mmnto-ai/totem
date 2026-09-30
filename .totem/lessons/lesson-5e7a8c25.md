## Lesson — A set id is the digest of the batch's own rows, as one compact array in committed order

**Tags:** hashing, serialization, whitelist
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

A whitelist set id is the first 8 hex of the sha256 over ONE compact JSON array of the batch's rows in committed order (key order engine then structuralClass, no whitespace, no trailing newline). It is taken over the batch's OWN slice while each batch's rows ride their own patch, so an earlier batch's id does not move when a later batch lands; one id over a union applies only when several batches ride one patch. A one-row batch still digests a one-element array, not the bare object, and the byte count alone does not identify the input (a swapped key order has the same length). The whitelist test pins each slice's digest (mmnto-ai/totem#2980, mmnto-ai/totem#2984).
