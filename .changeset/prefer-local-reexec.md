---
'@mmnto/cli': minor
---

Prefer-local re-exec at the entrypoint (mmnto-ai/totem#2018 L1). When a foreign totem binary — typically an ambient global install — starts inside a project that carries its own `@mmnto/cli` (workspace-HEAD build or pinned dependency, the ADR-072 cascade's deterministic tiers), it now delegates to the project-local build instead of running with the wrong dependency tree. The delegation is announced on stderr; `TOTEM_NO_REEXEC=1` opts out. Forecloses both variants of the recurring wrong-binary class: missing externalized peer SDKs (mmnto-ai/totem#2018) and stale-version shadowing (mmnto-ai/totem#2053).
