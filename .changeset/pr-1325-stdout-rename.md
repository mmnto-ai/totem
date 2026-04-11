---
'@mmnto/cli': patch
---

Rename `totem handoff --no-edit` to `--stdout` (#1325)

**User-visible CLI change.** The `--no-edit` flag on `totem handoff` never worked: Commander.js interpreted it as a boolean negation of a nonexistent `--edit` option, so passing `--no-edit` silently set an unrelated field to `false` and the command still tried to open `$EDITOR`. The flag has been renamed to `--stdout` (with `--lite` kept as an alias) which unambiguously prints the scaffold to stdout.

Anyone who was passing `--no-edit` was getting the default behavior anyway, so there is no functional regression — just a rename to something that actually works. Fixes #1317. Also deletes the orphaned `handoff-checkpoint` schema files that were stranded when #1316 removed the LLM-path code that referenced them (#1318).
