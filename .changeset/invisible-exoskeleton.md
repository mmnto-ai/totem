---
'@mmnto/cli': minor
---

## 1.10.0 — The Invisible Exoskeleton

Reduce adoption friction for new users and solo developers.

### Features

- **Pilot mode (#949):** Time-bounded warn-only hooks (14 days / 50 pushes). State tracked in `.totem/pilot-state.json`.
- **Enforcement tiers (#987):** Strict tier with spec-completed check + shield gate. Agent auto-detection via environment variables.
- **Solo dev experience (#1039):** `totem extract --local` for local git diffs. Global profile override (`~/.totem/`) with `totem init --global`.

### Fixes

- **.env parser (#1114):** Replaced custom regex with `dotenv` library in CLI and MCP packages.
- **Spec infrastructure (#1016):** Query expansion for test-related keywords + docstring enrichment.
- **Manifest rehash (#1155):** Pipeline 5 observation capture now re-hashes compile manifest after mutation.
- **Pre-push format check (#1156):** `format:check` added to pre-push hook template. Package-manager-agnostic detection.
- **Exit code fix (#1161):** `--yes` mode now sets `process.exitCode = 1` when all lessons are suspicious.

### Internal

- **Extract refactor (#1159):** Split 1,165-line extract.ts into 5 focused modules with unified assembler.
- **"Missed Caught" audit (#1153):** Historical bot findings categorized by detection tier (44% deterministic).
