---
'@mmnto/cli': minor
---

Add suspicious lesson detection to `totem extract` with `--yes` mode blocking

- New `flagSuspiciousLessons()` heuristic validator detects prompt injection indicators: instructional leakage, XML tag leakage, Base64 payloads, excessive unicode escapes, and overly long headings
- Interactive UI marks suspicious lessons with `[!]` prefix and deselects them by default
- `--yes` mode automatically blocks suspicious lessons with warnings and exits non-zero for CI pipelines
- Dry-run mode surfaces suspicious flags in preview output
