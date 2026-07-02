## Lesson — Use conditional spreads for optional fields

**Tags:** serialization, json, compatibility
**Scope:** packages/core/src/spine/split.ts

Using conditional object spreads prevents 'undefined' values from being serialized into JSON. This ensures that adding new optional fields does not break byte-identical regression requirements for existing data paths.
