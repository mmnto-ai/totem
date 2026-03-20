## Lesson — Avoid using dynamic imports in shared utility modules

**Tags:** performance, curated
**Pattern:** \bimport\s*\(
**Engine:** regex
**Scope:** **/shared/**/*.ts, **/shared/**/_.js, **/utils/**/_.ts, **/utils/**/_.js, !\*\*/_.test.ts
**Severity:** warning

Avoid dynamic imports in shared utility modules. Defer dynamic imports to specific command handlers where they can effectively optimize startup speed.
