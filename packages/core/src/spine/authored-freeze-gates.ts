// ─── ADR-112 §5.1/§5.3 Slice D5 — the authored freeze-time preconditions (pure) ─
//
// When the AUTHORED producer freezes a cert-run split, three orthogonal, fail-loud
// gates must hold BEFORE any lock/substrate is written (strategy D5 ruling
// 2026-07-02, Q2 + Q3). They are the §5 leakage guard + the §5.3 generalization
// floor made MECHANICAL — verified against real split/ledger facts, never the
// author's `authoredAfterSplit:true` attestation (Tenet 13 sensor-not-actuator ⊕
// Tenet 4 fail-loud). Detect-never-repair: a violation THROWS `GATE_INVALID`; the
// materializer never re-freezes or re-authors (that is a human authoring-lane act).
//
// COMPOSE-NEVER-REPLACE (strategy Q3): the three axes are independent — a rule can
// pass one and fail another — so `assertAuthoredFreezePreconditions` collects ALL
// violations across ALL axes and throws ONCE naming every one, never short-circuits
// on the first (else a two-round debug for the operator).
//
// Pure: no I/O. The caller passes the resolved split + the EFFECTIVE (last-per-
// ruleId) authoring-ledger entries; the facts are DEREFERENCED from the split
// artifact (Tenet 20), never recomputed here.

import { TotemError } from '../errors.js';
import type { AuthoringLedgerEntry } from './authoring-ledger.js';
import type { SplitArtifact } from './split.js';

/**
 * A certifiable row's timestamp MUST be a full ISO-8601 instant with a time
 * component AND an explicit timezone — a date-only string (`2026-07-01`) makes
 * "frozen BEFORE authored" ambiguous within the day (codex Q3 + agy row-vii), and a
 * zone-less `2026-07-01T12:00:00` would be parsed by `Date.parse` as LOCAL time,
 * making the comparison timezone-nondeterministic across machines/CI (CR Minor).
 * Require `Z` or a numeric `±hh:mm` offset so the temporal proof is deterministic.
 */
const FULL_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** A parsed certifiable instant, or a fail-loud reason (never an exception — the pure gates aggregate, they do not throw for control flow). */
type InstantParse = { ok: true; ms: number } | { ok: false; message: string };

/**
 * Parse a certifiable-row instant to epoch-ms, fail-loud on a date-only/malformed
 * value (agy row-vii: never fall back to `now`/0 or silently skip the check).
 * Returns a RESULT UNION rather than throwing — the caller aggregates the reason
 * into the single `GATE_INVALID` (compose-never-replace), so there is no
 * exceptions-as-control-flow inside the pure gate.
 */
function parseCertifiableInstant(value: string, label: string): InstantParse {
  if (!FULL_INSTANT_RE.test(value.trim())) {
    return {
      ok: false,
      message:
        `${label} ('${value}') is not a full ISO-8601 instant (needs a T<hh>:<mm> time) — ` +
        `a date-only/malformed stamp makes the frozen-before-authoring proof ambiguous`,
    };
  }
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) {
    return { ok: false, message: `${label} ('${value}') is not a parseable ISO-8601 instant` };
  }
  return { ok: true, ms };
}

/**
 * Q2 (strategy floor): the held-out slice must be ≥ 50% of the non-excluded
 * scored window `N = |trainPrs| + |heldOutPrs|` — inclusive (`=0.5` passes), so
 * per-rule generalization evidence (§5.3) rests on a substantial unseen slice.
 * Returns [] or the single violation message.
 */
export function checkHeldOutFloor(split: SplitArtifact): string[] {
  const heldOut = split.heldOutPrs.length;
  const n = split.trainPrs.length + heldOut;
  if (n === 0) {
    return ['Q2 held-out floor: the non-excluded window is empty (|train| + |heldOut| == 0)'];
  }
  const ratio = heldOut / n;
  if (ratio < 0.5) {
    return [
      `Q2 held-out floor: heldOut/N = ${heldOut}/${n} = ${ratio.toFixed(4)} < 0.50 — the authored ` +
        `cert window must hold out at least half the scored PRs (ADR-112 §5.3 generalization floor)`,
    ];
  }
  return [];
}

/**
 * Q3.1 (strategy temporal): the split's `frozenAt` must PRECEDE every effective
 * rule's `authoredAt` — §5.1 "frozen before authoring" made mechanical. A split
 * frozen at-or-after authoring is a HARD FAIL (the author may have tuned matchers
 * against held-out code — an exposure re-freezing cannot undo). Returns per-rule
 * violation messages ([] if clean). A missing `frozenAt` is itself a violation
 * (no mechanical proof possible).
 */
export function checkFrozenBeforeAuthoring(
  split: SplitArtifact,
  effectiveEntries: readonly AuthoringLedgerEntry[],
): string[] {
  const issues: string[] = [];
  if (split.frozenAt === undefined) {
    return [
      'Q3 temporal: the split carries no `frozenAt` stamp — an authored cert split MUST record ' +
        'its freeze instant so frozen-before-authoring is mechanically provable (ADR-112 §5.1)',
    ];
  }
  const frozen = parseCertifiableInstant(split.frozenAt, 'split.frozenAt');
  if (!frozen.ok) {
    return [`Q3 temporal: ${frozen.message}`];
  }
  const frozenMs = frozen.ms;
  for (const entry of effectiveEntries) {
    const authored = parseCertifiableInstant(entry.authoredAt, `rule '${entry.ruleId}' authoredAt`);
    if (!authored.ok) {
      issues.push(`Q3 temporal: ${authored.message}`);
      continue;
    }
    if (frozenMs >= authored.ms) {
      issues.push(
        `Q3 temporal: rule '${entry.ruleId}' was authored at '${entry.authoredAt}' but the split ` +
          `froze at '${split.frozenAt}' — the split must freeze STRICTLY BEFORE authoring ` +
          `(frozenAt < authoredAt); a split frozen at-or-after authoring is a §5.1 leakage event`,
      );
    }
  }
  return issues;
}

/**
 * Q3.2 (strategy membership): every effective rule's `positiveFixturePrs` must
 * land in the split's TRAIN slice — a held-out positive fixture is §5(2)/falsifier
 * §1(c) leakage. Returns per-(rule,pr) violation messages ([] if clean).
 */
export function checkPositiveFixturesTrainSide(
  split: SplitArtifact,
  effectiveEntries: readonly AuthoringLedgerEntry[],
): string[] {
  const trainSet = new Set(split.trainPrs);
  const heldOutSet = new Set(split.heldOutPrs);
  const issues: string[] = [];
  for (const entry of effectiveEntries) {
    for (const pr of entry.positiveFixturePrs) {
      if (!trainSet.has(pr)) {
        const slice = heldOutSet.has(pr) ? 'held-out' : 'outside the split';
        issues.push(
          `Q3 membership: rule '${entry.ruleId}' positive fixture PR #${pr} is in ${slice}, not the ` +
            `train slice — a non-train positive fixture is an ADR-112 §5(2) leakage violation`,
        );
      }
    }
  }
  return issues;
}

/**
 * The composed authored freeze precondition (strategy D5 Q2 + Q3). Runs all three
 * orthogonal gates, aggregates EVERY violation, and throws ONE `GATE_INVALID`
 * naming them all (compose-never-replace; both axes surfaced, never short-circuit).
 * No-op on clean input. Call at the authored producer's freeze step, before any
 * lock/substrate write (Tenet 13 sensor-not-actuator: detect + fail, never repair).
 */
export function assertAuthoredFreezePreconditions(
  split: SplitArtifact,
  effectiveEntries: readonly AuthoringLedgerEntry[],
): void {
  const issues = [
    ...checkHeldOutFloor(split),
    ...checkFrozenBeforeAuthoring(split, effectiveEntries),
    ...checkPositiveFixturesTrainSide(split, effectiveEntries),
  ];
  if (issues.length > 0) {
    throw new TotemError(
      'GATE_INVALID',
      `authored cert freeze rejected — ${issues.length} precondition violation(s):\n` +
        issues.map((i) => `  • ${i}`).join('\n'),
      'Re-freeze a split BEFORE authoring, keep every positive fixture train-side, and hold out ' +
        '≥ half the window; the materializer never auto-repairs a leakage event (ADR-112 §5.1/§5.3).',
    );
  }
}
