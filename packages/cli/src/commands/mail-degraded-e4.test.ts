/**
 * Prop 309 P2 degraded-mode test pack — entry E4 (induced-failure).
 *
 * Boundary (verbatim scope): ECL/mail poll completeness. Induced faults →
 * required behavior: "basename collision · own-broadcast exclusion · glob
 * failure → surfaced or LOUDLY accounted, never silent narrowing."
 *
 * Pack contract — every induced-failure test carries three assertions:
 *   1. The accounting fires (degraded output announces itself — never output
 *      indistinguishable from a clean poll).
 *   2. The backstop throws. `totem mail` is a READ-ONLY path, so per
 *      ADR-115 § 2 the requirement is a DEGRADED/UNVERIFIED-style envelope in
 *      rendered output — the structured `warnings` channel (rendered as
 *      `Warning: …` lines by `formatTextResult`) IS that envelope — not a
 *      nonzero exit. Where this pack pins an exit code it is pinning the
 *      deliberate exit-0-with-envelope contract, never blessing silence.
 *   3. Recovery/control: a positive control (healthy fixture poll renders
 *      everything it should) AND fault-removed-returns-to-green.
 *
 * Framing defects:
 *   - mmnto-ai/totem#2462 — "silent mail-suppression class": the own-broadcast
 *     exclusion at mail.ts (`if (opts.includeProcessed !== true && toLower ===
 *     'broadcast' && selfLower.has(senderSeat)) continue;`) assumes SELF is one
 *     seat; post-dirs-union the default poll resolves ALL resident seats, so a
 *     resident sender's broadcast is suppressed from every seat's default
 *     render — silently, no accounting line.
 *   - mmnto-ai/totem#2509 — the accounting-line gap: the default render gives
 *     no account of items dropped by the exclusion; the required fix is a
 *     rendered accounting line when suppression drops files mark-absent for
 *     ≥1 resident non-sender seat. NOT yet implemented — the required-behavior
 *     assertion below is `test.fails` with this issue ref (repo rule:
 *     suppressions carry a ticket-ref comment), written against the REQUIRED
 *     behavior so it EXECUTES every run and flips the moment the fix lands
 *     (vitest 4 dropped `test.fixme`; `test.fails` is the in-repo vitest's
 *     expected-fail primitive — green while the defect stands, loudly red
 *     once the assertions pass and the marker must be removed).
 *
 * Filesystem-driven, hermetic (fresh tmp workspace per test), same fixture
 * idiom as mail.test.ts. Assertions target the structured `MailPollResult`
 * (the durable hook contract); the text formatter is human-only EXCEPT the
 * verdict line's `INCOMPLETE` token invariant, a pinned contract since
 * mmnto-ai/totem#2516 — a degraded scan whose verdict sentence is
 * indistinguishable from a clean scan's IS the silent-narrowing class this
 * pack exists to catch, so that one line is asserted like any other contract.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

// Mock node:fs so spyOn works in ESM — same pattern as core's session-id.test.ts.
// Passthrough spread: every call behaves identically to real fs until a test
// installs a targeted spy (and restores it in `finally`).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import {
  SEAT_LIFECYCLE_FILENAME,
  SEAT_LIFECYCLE_SCHEMA_VERSION,
  type SeatLifecycleState,
  writeSeatLifecycle,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { formatTextResult, pollMail, resolveMailExitCode } from './mail.js';

// ─── Fixture helpers ────────────────────────────────────

let tmpRoot: string;
let workspace: string;

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

interface OutboxFile {
  name: string;
  to: string;
  from?: string;
  subject?: string;
  date?: string;
}

/** `<repo>/.totem/orchestration/<senderAgent>/outbox/<file>.md` — same shape as mail.test.ts. */
function writeOutbox(repo: string, senderAgent: string, files: OutboxFile[]): void {
  const outbox = path.join(workspace, repo, '.totem', 'orchestration', senderAgent, 'outbox');
  mkDir(outbox);
  for (const f of files) {
    const content = [
      '---',
      `from: ${f.from ?? senderAgent}`,
      `to: ${f.to}`,
      `date: ${f.date ?? '2026-07-20T1700Z'}`,
      `subject: ${f.subject ?? '(no subject)'}`,
      '---',
      '',
      'Body text.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(outbox, f.name), content, 'utf-8');
  }
}

/**
 * The `totem` basename pre-resolves to [totem-claude, totem-gemini] via the
 * cohort map; materializing the seat dirs puts resolution on the
 * post-dirs-union DEFAULT path (source 'dirs', no env override) — the exact
 * multi-seat condition of mmnto-ai/totem#2462: the default poll resolves ALL
 * resident seats, and the own-broadcast exclusion assumes SELF is one seat.
 */
function selfRepoRootWithSeats(seats: string[]): string {
  const root = mkDir(path.join(workspace, 'totem'));
  // The #2312 walk-up needs a `.totem` marker to anchor the repo root on.
  const orchDir = mkDir(path.join(root, '.totem', 'orchestration'));
  for (const seat of seats) mkDir(path.join(orchDir, seat));
  return root;
}

/** `<root>/.totem/orchestration/<seat>/processed/_broadcast/<name>` — a consumed-broadcast mark. */
function writeBroadcastMark(root: string, seat: string, names: string[]): void {
  const dir = mkDir(path.join(root, '.totem', 'orchestration', seat, 'processed', '_broadcast'));
  for (const n of names) fs.writeFileSync(path.join(dir, n), '---\nto: broadcast\n---\n', 'utf-8');
}

/**
 * THE INDUCED FAULT: unparseable bytes where a lifecycle marker belongs
 * (mmnto-ai/totem#2511 failure table, corrupt-marker row). Real bytes on real
 * disk — no mocks, so core's real read path produces the real degradation.
 * Returns the marker path the warning must name.
 */
function writeCorruptLifecycleMarker(root: string, seat: string): string {
  const markerPath = path.join(root, '.totem', 'orchestration', seat, SEAT_LIFECYCLE_FILENAME);
  mkDir(path.dirname(markerPath));
  fs.writeFileSync(markerPath, '{ "schemaVersion": 1, "state": "susp', 'utf-8');
  return markerPath;
}

/** The healthy counterpart, written through core's real writer (the `totem seat` producer). */
function writeLifecycleMarker(root: string, seat: string, state: SeatLifecycleState): string {
  return writeSeatLifecycle(root, seat, {
    schemaVersion: SEAT_LIFECYCLE_SCHEMA_VERSION,
    state,
    since: '2026-08-11T00:00:00.000Z',
  });
}

/**
 * The single rendered line that asserts inbox state (the mmnto-ai/totem#2516
 * `INCOMPLETE` invariant). Module-scope twin of the fault-3 addendum's local
 * `verdictLine` so fault 4 can pin the same invariant without reaching into
 * another describe's closure.
 */
function verdictLineOf(text: string): string {
  const line = text.split('\n').find((l) => l.includes('INCOMPLETE') || l.includes('unread'));
  expect(line, 'a verdict line is always rendered').toBeDefined();
  return line!;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mail-e4-'));
  workspace = mkDir(path.join(tmpRoot, 'workspace'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// ─── Fault 1: basename collision ────────────────────────
// Two seats converge on one addressed-inbound basename. Required: surface
// both or loudly account — never silently narrow/merge/drop one.

describe('E4 fault 1 — basename collision is surfaced AND loudly accounted', () => {
  const NAME = '2026-07-20T1717Z-totem-claude-round-reply.md';

  it('both colliding dispatches surface AND the collision warning names every seat path (regression lock)', () => {
    // Cross-repo variant: distinct outbox-owner seats in distinct repos.
    writeOutbox('totem-strategy', 'strategy-claude', [{ name: NAME, to: 'totem-claude' }]);
    writeOutbox('liquid-city', 'lc-claude', [{ name: NAME, to: 'totem-claude' }]);

    const result = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });

    // Pack 1 — the accounting fires: the degraded envelope announces itself.
    const collisionWarnings = result.warnings.filter((w) =>
      w.startsWith('cross-sender basename collision'),
    );
    expect(collisionWarnings).toHaveLength(1);
    expect(collisionWarnings[0]).toContain(NAME);
    expect(collisionWarnings[0]).toContain('totem-strategy/strategy-claude');
    expect(collisionWarnings[0]).toContain('liquid-city/lc-claude');
    // Pack 2 — backstop for a read-only path (ADR-115 § 2): no silent
    // narrowing — BOTH dispatches render; the warnings envelope (not an exit
    // code) is the loud announcement. Load-bearing downstream: the same
    // warnings channel reds the `ecl-gc --compact` A2.2 completeness gate
    // (`warnings.length === 0` arm, mmnto-ai/totem#2309).
    expect(result.mail).toHaveLength(2);
    expect(result.mail.map((m) => m.file)).toEqual([NAME, NAME]);
  });

  it('positive control + fault-removed: distinct basenames render clean with zero warnings', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-20T1717Z-totem-claude-round-reply.md', to: 'totem-claude' },
    ]);
    writeOutbox('liquid-city', 'lc-claude', [
      { name: '2026-07-20T1718Z-totem-claude-lane-note.md', to: 'totem-claude' },
    ]);

    const result = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });

    expect(result.mail).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(resolveMailExitCode(result)).toBe(0);
  });
});

// ─── Fault 2: own-broadcast exclusion ───────────────────
// A broadcast from a RESIDENT sender seat, unread for a non-sender resident
// seat. Required: render it, or print an accounting line naming the
// suppression (mmnto-ai/totem#2509 — unimplemented today).

describe('E4 fault 2 — own-broadcast suppression is never silent (mmnto-ai/totem#2462, #2509)', () => {
  const BCAST = '2026-07-20T2326Z-broadcast-cohort-note.md';
  const RESIDENT_SEATS = ['totem-claude', 'totem-gemini'];

  /** Default-resolution poll (no env override) over the two-seat fixture. */
  function pollTwoSeat(opts: Parameters<typeof pollMail>[0] = {}) {
    return pollMail({
      repoRoot: selfRepoRootWithSeats(RESIDENT_SEATS),
      workspace,
      env: {},
      ...opts,
    });
  }

  // RED ROW — required behavior, unimplemented. `test.fails` carries the
  // ticket ref per the repo rule (suppressions need a ticket-ref comment);
  // the body is written against the REQUIRED behavior so it EXECUTES every
  // run (an expected failure while #2509 stands) and flips the run loudly
  // red the moment the fix lands and the marker must be removed. (vitest 4
  // dropped `test.fixme`; `test.fails` is this repo's vitest's expected-fail
  // primitive.)
  //
  // Today's actual behavior (regression-documented, NOT locked): mail.ts's
  // own-broadcast exclusion hits `continue` with no warning and no accounting
  // line, so the default two-seat poll returns `mail: []`, `warnings: []` —
  // rendered as "No unread mail addressed to totem-claude, totem-gemini or
  // broadcast." That is the #2462 silent-suppression class: the dispatch is
  // mark-absent for the resident NON-sender seat (totem-gemini), yet the
  // render is indistinguishable from a genuinely clean inbox.
  test.fails(
    'REQUIRED (mmnto-ai/totem#2509): a resident-sender broadcast unread for a non-sender seat is rendered OR loudly accounted — never silently dropped',
    () => {
      writeOutbox('totem', 'totem-claude', [
        { name: BCAST, to: 'broadcast', subject: 'cohort note' },
      ]);
      // No sanity assertion in this body, deliberately: `test.fails` is
      // satisfied by ANY failure, so an extra assertion here would let an
      // unrelated seat-resolution regression keep the marker green without
      // the #2509 assertion ever running (CR round-1 catch). The two-seat
      // resolution is asserted by the positive control below on the same
      // fixture shape, where a regression fails loudly as a real failure.
      const result = pollTwoSeat();

      // Pack 1 + 2 — accounting fires / degraded envelope: the poll must
      // either render the dispatch (to the non-sender seat) or name the
      // suppression in the warnings channel — the read-only path's
      // DEGRADED-style announcement per ADR-115 § 2. The exact accounting
      // wording is #2509's to define; the assertion keys on the suppressed
      // basename so any honest accounting line satisfies it.
      const renderedToNonSender = result.mail.some((m) => m.file === BCAST);
      const accounted = result.warnings.some((w) => w.includes(BCAST));
      expect(renderedToNonSender || accounted).toBe(true);
    },
  );

  it('positive control: a NON-resident sender broadcast surfaces to the same two-seat default poll', () => {
    // Healthy-fixture control: the same poll renders everything it should
    // when the sender is NOT a resident seat (the exclusion arm cannot fire).
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: BCAST, to: 'broadcast', subject: 'theirs' },
    ]);
    const result = pollTwoSeat();
    expect(result.selfAgents.agents).toEqual(['totem-claude', 'totem-gemini']);
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.file).toBe(BCAST);
    expect(result.warnings).toEqual([]);
  });

  it('fault-removed control: removing the sender from the resident set surfaces the identical broadcast', () => {
    // Same dispatch, same fixture — but SELF is restricted to the non-sender
    // seat, so the exclusion arm (`selfLower.has(senderSeat)`) cannot fire.
    // Proves the dispatch is deliverable and the suppression is specifically
    // the resident-sender arm, not a fixture artifact.
    writeOutbox('totem', 'totem-claude', [{ name: BCAST, to: 'broadcast' }]);
    const result = pollMail({
      repoRoot: selfRepoRootWithSeats(RESIDENT_SEATS),
      workspace,
      env: { TOTEM_SELF_AGENT: 'totem-gemini' },
    });
    expect(result.mail).toHaveLength(1);
    expect(result.mail[0]!.file).toBe(BCAST);
  });

  it('over-correction guard: a single-seat poll where SELF IS the sender still excludes its own broadcast (mmnto-ai/totem#2364, intended)', () => {
    // The #2509 fix must not over-correct into surfacing a seat's OWN
    // broadcast back to the sender itself — that exclusion is the shipped
    // #2364 behavior. Lock it so the accounting-line fix stays scoped to
    // non-sender seats.
    writeOutbox('totem', 'totem-claude', [{ name: BCAST, to: 'broadcast' }]);
    const result = pollMail({
      repoRoot: selfRepoRootWithSeats(RESIDENT_SEATS),
      workspace,
      env: { TOTEM_SELF_AGENT: 'totem-claude' },
    });
    expect(result.mail).toEqual([]);
  });
});

// ─── Fault 3: glob/scan failure ─────────────────────────
// The scan resolves zero repos/dirs while dispatches exist on disk.
// Required: refuse a silently-clean inbox over an incomplete scan — announce
// the degradation.

describe('E4 fault 3 — scan failure announces itself, never a silent clean inbox', () => {
  const MAIL_A = '2026-07-20T1800Z-totem-claude-from-strategy.md';
  const MAIL_B = '2026-07-20T1801Z-totem-claude-from-lc.md';

  function writeHealthyFixture(): void {
    writeOutbox('totem-strategy', 'strategy-claude', [{ name: MAIL_A, to: 'totem-claude' }]);
    writeOutbox('liquid-city', 'lc-claude', [{ name: MAIL_B, to: 'totem-claude' }]);
  }

  it('workspace scan root unresolvable (ENOTDIR) with dispatches on disk → degraded envelope, empty mail, exit 0', () => {
    writeHealthyFixture();
    // Positive control (pack 3): the healthy fixture renders everything.
    const healthy = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });
    expect(healthy.mail).toHaveLength(2);
    expect(healthy.warnings).toEqual([]);

    // Induce: point the scan root at a FILE — fs.existsSync passes,
    // readdirSync throws ENOTDIR, enumerateOutboxes resolves ZERO repos while
    // the dispatches exist on disk under the real workspace. No mocks: the
    // real errno drives the real catch arm.
    const brokenRoot = path.join(tmpRoot, 'workspace-as-file');
    fs.writeFileSync(brokenRoot, 'not a directory', 'utf-8');
    const degraded = pollMail({
      repoRoot: selfRepoRootWithSeats([]),
      workspace: brokenRoot,
      env: {},
    });

    // Pack 1 — the accounting fires: the scan failure is named in the
    // warnings channel, so the rendered output carries `Warning: workspace
    // scan failed: …` lines and is distinguishable from a clean poll.
    expect(degraded.warnings.some((w) => w.startsWith('workspace scan failed'))).toBe(true);
    // Pack 2 — backstop for a read-only path (ADR-115 § 2): the envelope is
    // the announcement; the exit code stays 0 by the deliberate
    // `resolveMailExitCode` contract (only an UNRESOLVED self is exit 2 — a
    // scan failure still resolved self, and the warnings channel is the
    // DEGRADED envelope). Pinning exit 0 here pins that contract, not the
    // silence. The poll also asserts nothing it cannot back: no mail entries
    // are fabricated over the incomplete scan.
    expect(degraded.mail).toEqual([]);
    expect(degraded.scanned).toBe(0);
    expect(resolveMailExitCode(degraded)).toBe(0);

    // Fault-removed-returns-to-green (pack 3): repoint at the healthy scan
    // root and the same fixture polls clean.
    const recovered = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });
    expect(recovered.mail).toHaveLength(2);
    expect(recovered.warnings).toEqual([]);
  });

  it('one repo orchestration scan fails (EACCES) → failure named, healthy sibling still surfaces; fault-removed returns to green', () => {
    writeHealthyFixture();
    // Induce: targeted readdirSync failure on ONE repo's orchestration dir —
    // the exact path mail.ts scans (`<workspace>/totem-strategy/.totem/
    // orchestration`). Path-conditional passthrough keeps every other fs call
    // real. (fs spy pattern: core session-id.test.ts.)
    const brokenMarker = path.join('totem-strategy', '.totem', 'orchestration');
    const realReaddirSync = fs.readdirSync;
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation((target, options) => {
      if (String(target).endsWith(brokenMarker)) {
        const err = new Error(
          `EACCES: permission denied, scandir '${String(target)}'`,
        ) as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return realReaddirSync(target, options as never) as never;
    });
    try {
      const degraded = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });
      // Pack 1 — the accounting fires: the failed repo is NAMED.
      expect(
        degraded.warnings.some((w) => w.startsWith('orchestration scan failed (totem-strategy)')),
      ).toBe(true);
      // Pack 2 — backstop: skip-don't-abort, never silent narrowing — the
      // healthy sibling repo's dispatch still surfaces, and the failed repo's
      // absence is announced (above) rather than folded into a fake-clean
      // inbox. Exit stays 0 per the read-only degraded-envelope contract.
      expect(degraded.mail.map((m) => m.file)).toEqual([MAIL_B]);
      expect(resolveMailExitCode(degraded)).toBe(0);
    } finally {
      spy.mockRestore();
    }

    // Pack 3 — fault-removed-returns-to-green: with the scan healthy again,
    // BOTH dispatches surface with zero warnings.
    const recovered = pollMail({ repoRoot: selfRepoRootWithSeats([]), workspace, env: {} });
    expect(recovered.mail.map((m) => m.file).sort()).toEqual([MAIL_A, MAIL_B].sort());
    expect(recovered.warnings).toEqual([]);
  });
});

// ─── Fault 3 addendum: qualified verdict (mmnto-ai/totem#2516) ──
// A degraded scan must never produce a verdict sentence identical to a
// clean scan's — the discriminator is the single greppable token
// INCOMPLETE, so the assertion pins an invariant, not fragile prose.
// Ruled wording (#2516 comment, operator-greenlit 2026-07-31; N = scan-
// warning count, M = unread count):
//   clean empty:     `No unread mail addressed to <agents>.`   (unchanged)
//   degraded empty:  `Scan INCOMPLETE (N warning(s) above) — no unread mail
//                     found in the scanned locations; unread mail may exist
//                     in the unscanned ones.`
//   clean non-empty: `M unread:`                                (unchanged)
//   degraded non-empty: `M unread — scan INCOMPLETE (N warning(s) above);
//                     more may exist in unscanned locations.`
// The word ORDER is asserted, not just word presence: the class defect
// (#2505 vacuous-green) was a reassuring lead followed by fine print, so
// the degraded-empty verdict must LEAD with the qualifier and must not
// contain the clean-empty sentence as a substring.

describe('E4 fault 3 addendum — qualified verdict line (mmnto-ai/totem#2516)', () => {
  const SEATS = ['totem-claude', 'totem-gemini'];
  const CLEAN_EMPTY_VERDICT =
    'No unread mail addressed to totem-claude, totem-gemini or broadcast.';

  /** The verdict is the single output line that asserts inbox state. */
  function verdictLine(text: string): string {
    const line = text.split('\n').find((l) => l.includes('INCOMPLETE') || l.includes('unread'));
    expect(line, 'a verdict line is always rendered').toBeDefined();
    return line!;
  }

  /** Two-seat fixture so the clean-empty sentence names real seats — making
   *  the substring-exclusion assertion (invariant 2) load-bearing. */
  function pollTwoSeat(opts: Parameters<typeof pollMail>[0] = {}) {
    return pollMail({
      repoRoot: selfRepoRootWithSeats(SEATS),
      workspace,
      env: {},
      ...opts,
    });
  }

  it('degraded empty-inbox verdict leads with the qualifier, carries the count, and excludes the clean sentence (invariants 1+2)', () => {
    // Induce: workspace scan root is a FILE (ENOTDIR) — zero repos scanned
    // while self resolves from the two-seat repoRoot. Same inducement as
    // fault 3's ENOTDIR arm; real errno, no mocks.
    const brokenRoot = path.join(tmpRoot, 'workspace-as-file');
    fs.writeFileSync(brokenRoot, 'not a directory', 'utf-8');
    const degraded = pollTwoSeat({ workspace: brokenRoot });

    // Pack 1 — accounting fires (precondition for the verdict assertion).
    expect(degraded.warnings.length).toBeGreaterThan(0);
    expect(degraded.mail).toEqual([]);

    const verdict = verdictLine(formatTextResult(degraded));
    // Invariant 1 (positive arm, empty case): the token is present, with
    // the paren-delimited count clause — the leading `(` pins the number's
    // left edge so a wrong multi-digit count cannot substring-match.
    expect(verdict).toContain('INCOMPLETE');
    expect(verdict).toContain(`(${degraded.warnings.length} warning(s) above)`);
    // Invariant 2: the qualifier LEADS — not a reassuring lead with fine
    // print after — and the clean-empty sentence is not a substring.
    expect(verdict.startsWith('Scan INCOMPLETE')).toBe(true);
    expect(verdict.includes('No unread mail addressed')).toBe(false);
    // Pack 2 — exit-0-with-envelope contract unchanged (ADR-115 § 2).
    expect(resolveMailExitCode(degraded)).toBe(0);
  });

  it('degraded non-empty verdict qualifies the unread count (invariant 1, non-empty positive arm)', () => {
    // Induce: one repo's orchestration scan fails (EACCES) while the
    // sibling repo's dispatch surfaces — fault 3's partial-scan arm.
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-20T1800Z-totem-claude-from-strategy.md', to: 'totem-claude' },
    ]);
    writeOutbox('liquid-city', 'lc-claude', [
      { name: '2026-07-20T1801Z-totem-claude-from-lc.md', to: 'totem-claude' },
    ]);
    const brokenMarker = path.join('totem-strategy', '.totem', 'orchestration');
    const realReaddirSync = fs.readdirSync;
    const spy = vi.spyOn(fs, 'readdirSync').mockImplementation((target, options) => {
      if (String(target).endsWith(brokenMarker)) {
        const err = new Error(
          `EACCES: permission denied, scandir '${String(target)}'`,
        ) as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return realReaddirSync(target, options as never) as never;
    });
    try {
      const degraded = pollTwoSeat();
      expect(degraded.warnings.length).toBeGreaterThan(0);
      expect(degraded.mail).toHaveLength(1);

      const verdict = verdictLine(formatTextResult(degraded));
      // Token + count + the unread figure, qualified — the render must not
      // present a bare `1 unread:` over an incomplete scan.
      expect(verdict).toContain('INCOMPLETE');
      expect(verdict).toContain(`(${degraded.warnings.length} warning(s) above)`);
      expect(verdict.startsWith('1 unread')).toBe(true);
      expect(resolveMailExitCode(degraded)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('clean-path control: empty-inbox verdict byte-identical to today, no INCOMPLETE (invariant 3 + invariant 1 negative arm)', () => {
    const clean = pollTwoSeat();
    expect(clean.mail).toEqual([]);
    expect(clean.warnings).toEqual([]);

    const text = formatTextResult(clean);
    // Byte-identical clean-empty sentence (acceptance 3 — no noise on the
    // healthy path), and the token is ABSENT: with zero warnings an
    // INCOMPLETE verdict would be a false-degraded cry-wolf.
    expect(text).toContain(CLEAN_EMPTY_VERDICT);
    expect(verdictLine(text)).toBe(CLEAN_EMPTY_VERDICT);
    expect(verdictLine(text).includes('INCOMPLETE')).toBe(false);
    expect(resolveMailExitCode(clean)).toBe(0);
  });

  it('clean-path control: non-empty verdict byte-identical to today, no INCOMPLETE (invariant 3 + invariant 1 negative arm)', () => {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: '2026-07-20T1800Z-totem-claude-from-strategy.md', to: 'totem-claude' },
    ]);
    writeOutbox('liquid-city', 'lc-claude', [
      { name: '2026-07-20T1801Z-totem-claude-from-lc.md', to: 'totem-claude' },
    ]);
    const clean = pollTwoSeat();
    expect(clean.mail).toHaveLength(2);
    expect(clean.warnings).toEqual([]);

    const verdict = verdictLine(formatTextResult(clean));
    expect(verdict).toBe('2 unread:');
    expect(verdict.includes('INCOMPLETE')).toBe(false);
    expect(resolveMailExitCode(clean)).toBe(0);
  });
});

// ─── Fault 4: corrupt seat-lifecycle marker ─────────────
// mmnto-ai/totem#2511 ships a second read the poll depends on: the declared
// lifecycle marker that shrinks a broadcast DENOMINATOR. The failure table's
// corrupt-marker row is this slice's ADR-115 induced-failure entry, and its
// required direction is fail-OPEN: an unparseable marker must never shrink a
// denominator (wrongly closing an obligation) nor hide held mail — the
// narrowing here would be silent and would look exactly like a healthy poll.

describe('E4 fault 4 — a corrupt lifecycle marker never silently narrows (mmnto-ai/totem#2511)', () => {
  const SEATS = ['totem-claude', 'totem-gemini'];
  const BCAST = '2026-08-11T0930Z-broadcast-cohort-note.md';
  const DIRECTED = '2026-08-11T0931Z-totem-claude-directed.md';

  /** Sender is NON-resident, so the #2364 own-broadcast arm cannot fire. */
  function writeInbound(): void {
    writeOutbox('totem-strategy', 'strategy-claude', [
      { name: BCAST, to: 'broadcast', subject: 'cohort note' },
      { name: DIRECTED, to: 'totem-claude', subject: 'directed to the corrupt seat' },
    ]);
  }

  it('warning names the marker file, the seat STAYS in the broadcast denominator, and its directed mail still surfaces', () => {
    const root = selfRepoRootWithSeats(SEATS);
    const markerPath = writeCorruptLifecycleMarker(root, 'totem-claude');
    writeInbound();
    // Only the OTHER (readable) seat consumed the broadcast. If the corrupt
    // marker were read as suspended/retired — or if an unreadable marker were
    // treated as "not in the denominator" — the requirement would drop to 1 and
    // this broadcast would be silently subtracted: an obligation closed by a
    // file nobody could parse.
    writeBroadcastMark(root, 'totem-gemini', [BCAST]);

    const result = pollMail({ repoRoot: root, workspace, env: {} });

    // Pack 1 — the accounting fires, and it hands over the ONE-STEP recovery
    // target (#2511 amendment 2: the recovery route is "fix or delete the
    // marker", so the warning names the marker file).
    const lifecycleWarnings = result.warnings.filter((w) =>
      w.includes('unusable lifecycle marker'),
    );
    expect(lifecycleWarnings).toHaveLength(1);
    expect(lifecycleWarnings[0]).toContain(markerPath);
    expect(lifecycleWarnings[0]).toContain('totem-claude');
    // Pack 2 — backstop for a read-only path (ADR-115 § 2): the warnings channel
    // IS the degraded envelope (it also reds the `ecl-gc --compact` A2.2 gate,
    // mmnto-ai/totem#2309), and NOTHING narrows: the broadcast stays unread
    // because the unreadable seat is still counted, and the seat's directed mail
    // surfaces untouched. Exit stays 0 per the deliberate contract.
    expect(result.mail.map((m) => m.file).sort()).toEqual([BCAST, DIRECTED].sort());
    expect(result.selfAgents.agents).toEqual(SEATS);
    expect(resolveMailExitCode(result)).toBe(0);
    // The rendered verdict is distinguishable from a clean poll's.
    expect(verdictLineOf(formatTextResult(result))).toContain('INCOMPLETE');
  });

  it('positive control + fault-removed: a VALID suspended marker does exclude the seat; deleting the corrupt marker returns to green', () => {
    const root = selfRepoRootWithSeats(SEATS);
    writeInbound();
    writeBroadcastMark(root, 'totem-gemini', [BCAST]);

    // Positive control — NON-VACUITY for the assertion above: with a marker the
    // reader can actually parse, the exclusion really does fire (requirement
    // drops to 1, totem-gemini's mark closes the broadcast). So "the broadcast
    // stayed unread" under the corrupt marker is a measured difference, not a
    // mechanism that never fires. Directed mail still surfaces — suspension
    // touches the denominator only.
    const markerPath = writeLifecycleMarker(root, 'totem-claude', 'suspended');
    const suspended = pollMail({ repoRoot: root, workspace, env: {} });
    expect(suspended.mail.map((m) => m.file)).toEqual([DIRECTED]);
    expect(suspended.warnings.some((w) => w.includes('unusable lifecycle marker'))).toBe(false);

    // Fault-removed-returns-to-green: no marker at all ⇒ active by default, no
    // lifecycle warnings, and the same fixture polls exactly as a pre-#2511 tree
    // would (both seats in the denominator, so one mark leaves the broadcast
    // unread).
    fs.rmSync(markerPath);
    const recovered = pollMail({ repoRoot: root, workspace, env: {} });
    expect(recovered.warnings).toEqual([]);
    expect(recovered.mail.map((m) => m.file).sort()).toEqual([BCAST, DIRECTED].sort());
    expect(verdictLineOf(formatTextResult(recovered))).not.toContain('INCOMPLETE');
  });
});
