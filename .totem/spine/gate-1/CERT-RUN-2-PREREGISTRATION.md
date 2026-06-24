# Gate-1 Cert Run #2 — Pre-Registration (strategy#709, #516 §1/§2)

**Committed BEFORE scoring** — the pre-commitment is the integrity guarantee (a floor set after seeing the number is no floor). Authored by totem-claude; floor pre-committed by strategy-claude (0329Z/0330Z).

## Window (deterministic, outcome-blind)
- **asOfCommit** = `09b21bc3bf5c1933d7f2f313659d5d687a01c599` (lc #611, 2026-06-24T02:20:49Z)
- **Selection**: most-recent-N eligible (code-touching `.rs/.gd/.gdshader/.tscn`, excl bot-authors + revert pairs), chronological merge order. **N=40**, **70/30** chronological split → **train 28 (oldest) / held-out 12 (newest)**.
- Eligibility classifier validated: reproduces the original run-#1 n=28 in [518..602] exactly.
- **held-out (12)**: 585, 587, 589, 597, 600, 601, 602, 605, 607, 609, 610, 611

## Anchor classes = {is_finite, divisor} (api_misuse DROPPED — singleton n=1, deferred to skynet)

## Held-out positive controls (provenance: PR# · file · thread)
| class | PR | file | reviewer thread |
|---|---|---|---|
| is_finite | 597 | `packages/zomboid-sim/src/density_feedback.rs` | gemini "Enforce Finite Velocity Assertion — use `assert!` … finite values (not NaN or Inf)" |
| is_finite | 605 | `packages/zomboid-sim/src/damage.rs` | gemini "use `assert!` … floating-point calculations result in finite values (not NaN or Inf)" |
| is_finite | 610 | `packages/zomboid-sim/src/dismember_locomotion.rs` | gemini "use `assert!` instead of `debug_assert!` … finite values (not NaN or Inf)" |
| divisor | 589 | `apps/game-godot/shaders/vat_horde.gdshader` | gemini "Potential division by zero if `fps` is 0.0 … NaN or Infinity" |

(605 also carries a divisor thread on `GibDebrisRenderer.gd`; designated **is_finite** as its one primary class — the same-language Rust locus. The divisor firing on 605, if any, is still disposition-labeled.)

## Held-out negative controls (clean — rule must NOT fire)
- **clean Rust**: 607 (`test(560)` gib-event ABI parity — Rust, no finite/divisor defect). Sole clean-Rust negative (is_finite saturation makes clean-Rust scarce; full-exposure precision is the broader over-fire sensor).
- **clean GDScript**: 600, 601, 611

## Precision floor (LOCKED — strategy will not move it after seeing the result)
1. **Precision ≥ 0.90** over exposure = (2 anchor rules × held-out files in scope); ratio AND denominator both reported. FP = a fire on a location with no genuine instance of the class.
2. **Per-class non-vacuity**: is_finite fires on ≥1 of {597, 605, 610}; divisor fires on ≥1 of {589, 605}. A rule that never fires has vacuous precision and does NOT pass.
3. **Designated-negative zero-tolerance**: 0 fires on 607 (Rust) + 600/601/611 (gd). One fire = hard fail regardless of aggregate precision.

## Terminal states (#516 §4)
- **PASS** — both classes clear non-vacuity, precision ≥0.90, zero designated-negative fires.
- **HONEST NEGATIVE** — a class doesn't generalize (fires on no held-out positive) or precision <0.90 / a designated-negative fires.
- **INCONCLUSIVE (divisor only)** — re-record misses train 519 → divisor doesn't mint; is_finite carries the verdict.

## Pre-registered observations (honest framing)
- **divisor is a CROSS-LANGUAGE straddle**: train mint locus is Rust (519, `flow.rs` `cell_size > 0.0`); held-out divisor instances are GDScript/shader (589 `.gdshader`, 605 `.gd`). A Rust-pattern divisor rule may not fire on GDScript → divisor may be honest-negative by language mismatch (a real generalization result, not a defect). **is_finite is the robust same-language (Rust→Rust) test and carries the verdict.**
- **Scope caveat (#516)**: 2 classes, ~4 positive instances, 4 negatives → result is **indicative, not conclusive**; the conclusive test (api_misuse included, ≥2 instances/class) awaits skynet's larger corpus.
- **Slug→id backfill (pre-authorized)**: positive-control `targetRuleId` carries class slugs (`sim-float-finite-assert`, `guard-divisor-nonpositive`); after record, the minted ruleIds replace them (the sanctioned post-record reconciliation — does NOT change control designations or the floor). All post-record steps (derive-labels, freeze, run, backfill) are zero-LLM replay.
