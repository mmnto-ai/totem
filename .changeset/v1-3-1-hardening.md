---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

### Bug Fixes

- **Critical:** Fixed filter ordering in `totem lint` and `totem shield` — ignored patterns (e.g., `.strategy` submodule) were checked after the emptiness test, preventing branch-diff fallback from firing. The Layer 3 pre-push gate was silently passing. (#709)
- Fixed latent bug where AST rules with empty `pattern` fields could match every line when passed to the regex executor (#710)
- Replaced 13 raw `throw new Error()` calls with typed `TotemError` subclasses across core and CLI packages (#711)

### Improvements

- **Compiler facade refactor:** Split `compiler.ts` (600 lines) into focused modules — `compiler-schema.ts`, `diff-parser.ts`, `rule-engine.ts` — with `compiler.ts` as a clean coordinator. Public API unchanged. (#710)
- Added `TOTEM_DEBUG=1` env var for full stack traces during troubleshooting (#711)
- Added mandatory verify steps (lint + shield + verify_execution) to `totem spec` output (#708)
- Reverted to curated 147-rule set and added 59 lesson hashes to nonCompilable blocklist (#708)
