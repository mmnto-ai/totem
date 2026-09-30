## Lesson — Double-quote a YAML pattern that carries lone surrogate code units

**Tags:** yaml, serialization, migration
**Scope:** .totem/rules/mig-*.rule.yaml

A pattern containing lone surrogate code units is written as a double-quoted YAML scalar with the surrogates escaped, so that the parser yields the legacy string unit for unit. The check is a round trip from the WRITTEN file, compared with the frozen row, not a comparison of the string in memory before it was written (mmnto-ai/totem#2947, rule `5afaf8d0`).
