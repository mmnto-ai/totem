## Lesson — Anchor severity regexes to templates

**Tags:** regex, parsing, coderabbit
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Broad regexes matching italicized severity keywords can falsely trigger on verification prose like '_major version verified_'. Anchoring patterns to specific template structures, such as emoji-prefixed severity tags, prevents false-positive findings.
