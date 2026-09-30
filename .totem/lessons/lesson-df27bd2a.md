## Lesson — A legacy rule's own defect is a defective-source proposal, not an edit at the pin

**Tags:** migration, regex, fidelity
**Scope:** .totem/rules/mig-*.rule.yaml

A migrated record reproduces its frozen manifest row; changing the pattern to cure a defect of the legacy rule breaks the fidelity check and moves a bound path. When a reviewer finds such a defect, verify it against the frozen row, keep the record as translated, and route the defect as a `defective-source` proposal for the curator's second read (mmnto-ai/totem#2947, rule `24f112fe`).
