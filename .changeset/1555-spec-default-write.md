---
'@mmnto/cli': minor
---

`totem spec` now writes to `.totem/specs/<topic>.md` by default (`mmnto-ai/totem#1555`). Closes a tier-1 silent contract gap with the `/preflight` skill, which expected the spec file to materialize automatically — 6+ confirmed occurrences in the wild before this fix (preflight on totem#1441, two LC dogfood sessions, three claude-0008/0009 totem sessions).

**Behavior:**

- **Default (single-input):** writes `<gitRoot>/.totem/specs/<stem>.md`, where `<stem>` is the issue number (for issue/URL/`owner/repo#NNN` invocations) or the sanitized free-form topic. Sanitization replaces any character outside `[a-zA-Z0-9_-]` with a single dash, collapses runs, and trims leading/trailing dashes — `totem spec "migration plan"` writes `.totem/specs/migration-plan.md`. Logs `Spec saved to <relative-path>` to stderr on success.
- **`--out <path>`:** unchanged; writes to the exact path provided.
- **`--stdout` (new):** opt back into the legacy stdout-only behavior for piping (`totem spec 123 --stdout | grep ...`). Mutually exclusive with `--out` — passing both fails with a `TotemConfigError` before any LLM call.
- **Multi-input fallback:** when more than one input is passed and neither `--out` nor `--stdout` is set, the command falls back to stdout with a stderr hint suggesting `--out <path>`. Single-shot multi-input piping still works without surprise.
- **Path traversal guard:** topic strings like `../../etc/passwd` sanitize to `etc-passwd`, so the resolved path stays under `<gitRoot>/.totem/specs/`.
- **Monorepo safety:** path resolution uses `resolveGitRoot` from `@mmnto/totem`, so running `totem spec` from a sub-package writes to the repo-root specs directory, not a stray `packages/cli/.totem/specs/`.

**Naming convention.** Argument pass-through is the only shape that survives both numeric and free-form invocations without a normalization layer — `totem spec 1682` → `.totem/specs/1682.md`, `totem spec my-topic` → `.totem/specs/my-topic.md`. Slug-derived filenames add a stale-slug failure mode when issues get renamed; numeric-only would break free-form topics.

**Migration.** The default behavior change is a bug-fix-with-additive-escape-hatch (precedent: `mmnto-ai/totem#1747` discriminated-union shape change). Stdout-piping consumers add `--stdout`; preflight-skill consumers gain the file write they always expected.
