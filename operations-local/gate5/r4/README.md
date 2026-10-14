# Gate (5) — the R4 severity-lowering controls (mmnto-ai/totem#3044)

The harness half of the lift ruling's Q1 (a′) mechanism (mmnto-ai/totem-strategy#1486, the Q1 addendum's (ii)): the migration harness's fidelity leg admits one expected divergence, a record severity LOWER than its legacy row's, for a rule the ruling names under ADR-103's R4 clause. This directory holds the controls that measure that admission and every refusal around it.

## The contract (what the scorer's § 7 entry mirrors)

- **The allow-list.** `R4_SEVERITY_LOWERING_RULES` in `operations-local/gate5/mig-harness.mjs`, a NAMED export whose value is one array literal of plain string hashes (no computed member, no spread), so a parity control can read it from the file's source blob at `pin.harness.commit` by a deterministic parse. Today: `2266fc0dfe824f24` (the static named import from the core barrel) and `87aff037d7de47a7` (the fail-open catch ban). The ruling's date, 2026-11-16, is cited in the constant's comment and is not a mechanism: nothing keys on the clock; the list changes by a commit on a further ruling.
- **The inventory item.** `iv`, "severity lowered under R4", declared per lessonHash in the batch inventory's `inventory[]` beside `i`, `ii`, `iii`.
- **Its semantics.** Admissible only in `--set` mode; only on a hash in the allow-list; never beside `ii`. Each of those three is refused at inventory read, before any record is read (exit 2). Lowering only: record `warning` against legacy `error`, the closed `RuleSeveritySchema` pair. Equal severity under a declaration reads identical, with one stdout note that the declaration is inert. A raise, an undeclared lowering, or a severity outside the pair stays `unexpected` carrying `severity` (exit 1).
- **The row.** No new key. `fidelity.severity` stays the measured equality (false on a lowering); `fidelity.expectedDivergence` carries the string `severity (inventory iv: lowered under R4)`; `fidelity.declaredInventory` may contain `iv`; `unexpected` is empty. `harness-record.schema.json` moved with it: the `declaredInventory` items enum gained `iv`.

## The controls

`controls-r4.mjs` spawns the harness over fixtures DERIVED under `--scratch` from the pin's own records and manifest (a derived copy asserts its one-line delta, the K5b pattern). Nothing is committed but this script, this file and the run log.

```text
node operations-local/gate5/r4/controls-r4.mjs --scratch <dir> \
  --seed <strategy>/operations/310-r14-audit/seed-20.json \
  --corpus <strategy>/operations/310-r14-audit/inputs/compiled-rules.json \
  [--core <@mmnto/totem package dir>] [--r14-pin 78e7f196] [--base b1792d5a] [--out <log>]
```

| Arm | What it measures                                                                                                    | Expected                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A0  | the allow-list parsed from the harness source is the ruling's pair                                                  | two hashes, both named                                                |
| A1  | both named records lowered to `warning`, `iv` declared                                                              | exit 0; `expectedDivergence` the string; `unexpected` empty           |
| A2  | the same records, `iv` not declared                                                                                 | exit 1; `unexpected` = `['severity']`                                 |
| A3  | `iv` declared on a hash the ruling did not name                                                                     | exit 2 before any record; stderr names the allow-list                 |
| A4  | a raise under a declaration (a synthetic manifest row at legacy `warning`, the pin record at `error`)               | exit 1; `unexpected` = `['severity']`                                 |
| A5  | the pin records unmodified, `iv` declared                                                                           | exit 0; identical; the inert note once per record                     |
| A6  | `iv` under `--r14` (the K3 regression mode)                                                                         | exit 2; stderr names the mode                                         |
| A7  | `iv` beside `ii`                                                                                                    | exit 2; stderr names the pair                                         |
| A8a | the K3 regression over the R14 22 at the record pin (`git show` at `--r14-pin`)                                     | exit 0; the two fidelity lines equal `k3/k3-run.log`; `K3 reproduced` |
| A8b | batch 1's `--set` run over its 13 entries                                                                           | exit 0; the two fidelity lines equal `batch-1/harness-run.log`        |
| A9  | the schema enum admits `iv` now and did not at `--base`; every A1/A5 row is inside the new enum and outside the old | load-bearing schema move                                              |

`r4-controls-run.log` is the run of record at the commit that carries this directory; its path and hash are what the scorer's entry cites as artifact-linked evidence. A failing arm exits 1 and the log says which.
