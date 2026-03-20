## Lesson — 2026-03-06T03:34:53.287Z

**Tags:** style, curated
**Pattern:** \b(kafka|kubernetes|firestore)\b
**Engine:** regex
**Scope:** **/*.ts, **/*.js, package.json, **/*.yaml, **/*.yml
**Severity:** warning

Do not port legacy technical implementations (Kafka, Kubernetes, Firestore) into Totem. Use local primitives like LanceDB or terminal execution instead.
