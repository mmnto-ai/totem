## Lesson — When mapping violations to rules in SARIF generation,

**Tags:** sarif, error-handling

When mapping violations to rules in SARIF generation, failing to find a rule index should trigger a hard error rather than falling back to a default index (e.g., 0). Silent fallbacks attribute violations to the wrong rule definitions, making generated security reports misleading.
