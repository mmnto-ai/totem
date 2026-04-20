---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
'@totem/pack-agent-security': patch
---

Add `archivedAt` to `CompiledRuleBaseSchema` so Zod stops silently stripping it on round-trips (mmnto-ai/totem#1589).

Pre-#1589, the schema declared `status`, `archivedReason`, `badExample`, `goodExample`, and a half-dozen other lifecycle fields — but not `archivedAt`. Zod's default behavior strips unknown keys during parse/serialize. Every compile-write cycle that round-tripped `compiled-rules.json` through `CompiledRulesFileSchema.parse()` silently erased prior `archivedAt` values from archived rules. Postmerge archive scripts (`scripts/archive-postmerge-*.cjs`) set the field via raw JSON mutation; it survived on disk until the next `totem lesson compile --export` quietly rewrote the file. Observed on PR #1588 (rule `4b091a1bc7d286d6`, archived 2026-04-19, timestamp lost during postmerge re-export). GCA caught the drop and we restored the timestamp manually; this ticket prevents future losses at the schema level.

The field is declared `z.string().optional()` for backward compatibility with pre-#1589 manifests that never had the field populated. Existing call sites continue to work unchanged.

Four new tests in `compiler-schema.test.ts` pin the invariant: accepts a rule with `archivedAt` set, preserves the field across a full parse → serialize → parse round-trip, tolerates an active rule without the field, and preserves the full archive tuple (`status` + `archivedReason` + `archivedAt`) together.

Closes #1589.
