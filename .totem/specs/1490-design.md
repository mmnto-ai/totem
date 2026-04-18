# Implementation Design — #1490 Obfuscation Rule (PR2, part 2 of 2)

> Companion to `.totem/specs/1490.md`. Part of bundled PR2 with #1488 (see `1488-design.md`). Gemini's `1490.md` references `parseSemgrepRules` and `packages/pack-security/rules/obfuscated-string-concat.yml`; neither applies — the pack is data-only JSON shipped via `compiled-rules.json`, matching PR1's shape. This design overrides those references.

## Scope

Ship one hand-crafted compound ast-grep rule in `packages/pack-agent-security/compiled-rules.json` that closes ADR-089 attack surface 4 (Obfuscation). The rule's `any:` block covers the five primitives validated by spike #1489 (`.strategy/research/obfuscated-string-concat-spike/README.md`): `String.fromCharCode`, `Buffer.from` with `"hex"` or `"base64"` decoder, `atob` / `btoa`, numeric-array `.map().join()`, and `.split().reverse().join()`. Ship at `severity: error`, `immutable: true`, `manual: true`, `category: security`, with a `badExample` that passes the compile-time smoke gate and a paired fixture file under `test/fixtures/`.

**NOT in scope:** runtime instrumentation, template-literal obfuscation (`${'a'}${'b'}` fragmentation — niche, not in the spike catalog), expansion beyond the spike's five primitives, changes to `@mmnto/totem` core, new CLI surface. Severity escalation path via `totem doctor` is unnecessary since the spike's empirical FP rate on Totem is zero.

## Data model deltas

### One new `CompiledRule` entry in `packages/pack-agent-security/compiled-rules.json`

| Field             | Value                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lessonHash`      | 16-hex SHA-256 of heading + message                                                                                                                         |
| `lessonHeading`   | "Obfuscated string assembly via byte-level or encoding primitives"                                                                                          |
| `pattern`         | `""` (compound — carried on `astGrepYamlRule`)                                                                                                              |
| `engine`          | `"ast-grep"`                                                                                                                                                |
| `astGrepYamlRule` | `{rule: {any: [<5 per-primitive NapiConfig entries, one each>]}}`                                                                                           |
| `message`         | authored remediation naming the five primitive families and their legitimate alternatives                                                                   |
| `fileGlobs`       | `["packages/**/*.ts", "packages/**/*.js", "!scripts/**", "!.github/**", "!**/*.test.*", "!**/*.spec.*", "!**/test/**", "!**/tests/**"]` — mirrors PR1 shape |
| `severity`        | `"error"` (spike-validated, zero FP on Totem)                                                                                                               |
| `category`        | `"security"`                                                                                                                                                |
| `immutable`       | `true`                                                                                                                                                      |
| `manual`          | `true`                                                                                                                                                      |
| `badExample`      | a `String.fromCharCode` call assembling an attacker payload                                                                                                 |

The five `any:` entries map directly to the spike patterns:

1. `{ pattern: "String.fromCharCode($$$ARGS)" }`
2. `{ pattern: 'Buffer.from($_, "hex")' }`
3. `{ pattern: 'Buffer.from($_, "base64")' }`
4. `{ pattern: "atob($_)" }`
5. `{ pattern: "btoa($_)" }`
6. `{ pattern: "[$$$NUMS].map($_).join($_)" }` — bracket-array chain
7. `{ pattern: "$STR.split($_).reverse().join($_)" }` — reversal

(That is 7 `any:` entries to cover 5 primitive families, because `Buffer.from` and `atob`/`btoa` each need two sub-patterns for the two decoder variants and the two direction variants. Spike validated this set at 0 FPs.)

### One new fixture pair under `packages/pack-agent-security/test/fixtures/`

- `bad-obfuscation.ts` — exercises all 7 `any:` sub-patterns (one per obfuscation style) so a regression in any sub-pattern surfaces immediately.
- `good-obfuscation.ts` — benign patterns that must stay silent: standard string concatenation (`base + '/' + file`), template literals, legitimate `JSON.stringify` / `JSON.parse` chains, `Array.prototype.map` over non-numeric data, `string.split('.')` / `string.split(',')` without reverse-and-join.

### Test harness deltas

- `FIXTURE_CASES` in `rules.test.ts` gains one entry for the new hash (total 5 after #1488's 2 entries).
- `manifest.rules.length` drift-guard asserts `6` at the PR2 tip (PR1's 2 + #1488's 2 + #1490's 1 compound = 5 total; wait, that's 5; re-checking: PR1 shipped 2, PR2 adds 3 total — #1488 Rule A, #1488 Rule B, #1490 compound — total 5. The #1488 design doc will say 4; this one says 5).
- `ALLOWLIST` in `repo-sweep.test.ts` stays empty for the new hash. Spike validated 0 occurrences across `packages/`, `scripts/`, `.github/workflows/` at strategy pointer `9dc638e` (2026-04-16). Re-verify at PR2 tip — if any of the 7 sub-patterns surfaces a new legitimate call site, document it + add allowlist entry OR carve the pattern.

## State lifecycle

- **Rule in `compiled-rules.json`:** persistent, author-time. Identical lifecycle to PR1's rules.
- **Fixtures:** persistent, author-time.

No lifecycle boundary crossings. No runtime mutation.

## Failure modes

| Failure                                                   | Category          | Agent-facing surface                                      | Recovery                                                                     |
| --------------------------------------------------------- | ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Malformed `astGrepYamlRule`                               | init (pack-load)  | hard error via `NapiConfigSchema` parse in `readJsonSafe` | fix the rule body                                                            |
| `badExample` does not match under smoke gate              | init (test)       | hard error per-rule assertion                             | fix rule or snippet                                                          |
| `good-obfuscation.ts` fires (FP)                          | init (test)       | hard error per-rule FP assertion                          | narrow the offending sub-pattern                                             |
| `bad-obfuscation.ts` does not fire (TP miss)              | init (test)       | hard error per-rule TP assertion                          | broaden pattern or check fixture                                             |
| Repo-sweep fires on Totem src (new call site since spike) | init (sweep test) | hard error listing file + line                            | add `ALLOWLIST` entry with reason OR rewrite source OR carve the sub-pattern |
| Hash collision with existing pack rules                   | init (test)       | hard error via hash-uniqueness assertion                  | change heading                                                               |
| Bracket-array pattern matches legitimate numeric map code | init (FP test)    | caught by `good-obfuscation.ts`                           | narrow to require string-array context, or accept the FP if empirically rare |

No silent degradation. Tenet 4 compliant.

## Invariants to lock in via tests

1. New rule parses clean under `CompiledRulesFileSchema`.
2. Carries `immutable: true`, `severity: 'error'`, `manual: true`, `category: 'security'`, `engine: 'ast-grep'`.
3. `badExample` produces ≥1 match under the smoke gate.
4. Hash is deterministic from heading + message and unique within the pack.
5. `FIXTURE_CASES` covers the new hash with a bad/good pair.
6. `bad-obfuscation.ts` produces ≥1 match per sub-pattern family (fragment-level TP coverage — if `Buffer.from hex` stops firing but the rest do, we still catch the regression at file-level. An assertion on >=7 total matches across the bad fixture ensures each sub-pattern is exercised).
7. `good-obfuscation.ts` produces 0 matches.
8. Repo-sweep across `packages/**` returns zero matches for the new hash outside the `ALLOWLIST` (expected: empty).
9. PR1 and #1488 invariants all still pass.

## Open questions

### Q1: Single compound rule or 5 sibling rules?

- **Options:**
  - **(A) One compound rule with `any:` covering all 7 sub-patterns.** One hash, one message, one violation entry per match.
  - **(B) Five or seven sibling rules, one per primitive family.** Granular per-primitive messages ("Buffer.from hex decoding detected", etc.).
- **Recommendation: (A).** Matches PR1 precedent (#1486's 24-pattern compound, #1487's 5-pattern compound). The 7 sub-patterns share the same semantic: obfuscation to evade static analysis. A single violation message can name all families and direct the consumer to the correct remediation. Splitting bloats the manifest and the test harness without sharpening the signal.

### Q2: Fragment-level TP coverage in the bad fixture?

- **Options:**
  - **(A) Single `bad-obfuscation.ts` exercising all 7 sub-patterns, one assertion on total match count ≥ 7.** Simple, one fixture pair per rule (matches PR1).
  - **(B) Seven bad fixtures (or seven labeled sections with line-specific assertions), one per sub-pattern.** Isolates regressions to the specific sub-pattern family.
- **Recommendation: (A) with a line-range assertion.** Use a single fixture with clearly-commented section headers (one section per sub-pattern family). Assert total match count ≥ 7 — one per family. If a sub-pattern regresses and its section stops matching, the total count drops below 7 and the test fails with a count mismatch. Cheap regression isolation without fixture proliferation.

### Q3: Template-literal obfuscation (`${'a'}${'b'}`)?

- **Options:** (A) add a sub-pattern for interpolated-single-char-fragment templates; (B) defer to follow-up.
- **Recommendation: (B).** Not in the spike catalog; adding now violates scope discipline. File a follow-up only if observed in the wild.

### Q4: Severity at error vs warning?

- **Options:** (A) ship at error per spike recommendation and ADR-089 mandate; (B) ship at warning with `totem doctor` escalation path.
- **Recommendation: (A).** Spike empirically validated 0 FPs. Warning would invert the ADR-089 Zero-Trust posture for this attack surface.
