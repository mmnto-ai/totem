---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

Release 1.2.0 — ast-grep engine, compound rules, and shield CI hardening.

### Highlights

- **ast-grep pattern engine**: Third rule engine alongside regex and Tree-sitter. Patterns look like source code (`process.env.$PROP`, `console.log($ARG)`) — dramatically easier for LLMs to generate accurately.
- **ast-grep compound rules**: Full support for `has`/`inside`/`follows`/`not`/`all`/`any` operators via NapiConfig rule objects. Enables structural rules like "useEffect without cleanup."
- **Shield CI hardening**: `shieldIgnorePatterns` now filters the diff before linting, preventing `.strategy` submodule pointer changes from triggering false CI failures.
- **Dynamic import rules narrowed**: Code scanning alerts for dynamic imports in command files eliminated — rules now only apply to core/adapter code.
- **Case-insensitive hash matching**: `totem explain` and `totem test --filter` now match regardless of case.
- **README hardened**: Staff Engineer red team feedback addressed — deterministic enforcement, air-gapped operation, and git-committed artifacts all clarified.
- **Docs injection scoped**: Manual content injection now targets README only, not all docs.
