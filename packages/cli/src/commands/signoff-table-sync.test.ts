/**
 * The signoff skill's step-2a cohort table and core's `COHORT_AGENT_MAP` are
 * two copies of one bootstrap fallback (Proposal 282 § Scope item 3), and each
 * says it is kept in sync with the other. Nothing held them to it: the three
 * Kimi seats read "not seated" in the table for weeks after they were seated
 * (mmnto-ai/totem#2865). This lock holds the two RENDERINGS in this repository
 * to each other so a seat added to one copy alone fails here rather than in a
 * poll — and holds the ASSOCIATIONS, not just the id sets: a seat in the wrong
 * repository row or the wrong vendor column fails too (the Greptile P2 on the
 * first cut: a flat set comparison let a mis-filed seat through green).
 *
 * TODAY the table LEADS the map by exactly the four Kimi seats the roster of
 * record seats (`doctrine/cohort-roles.md` § 1.1 in the strategy repository,
 * which this test cannot read and does not claim to): the map's Kimi
 * propagation moves the mail-accounting fixtures and is its own change,
 * mmnto-ai/totem#2875. When the map gains them, `tableOnly` below becomes
 * empty and the pinned `KIMI_SEATS` assertion goes RED on purpose — the
 * tripwire that issue's second ask names: a human then empties `KIMI_SEATS`
 * and the lock becomes an equality. Nothing tightens by itself.
 */
import { describe, expect, it } from 'vitest';

import { knownCohortAgents } from '@mmnto/totem';

import { SIGNOFF_SKILL_CONTENT } from './init-templates.js';

/**
 * The repo → seat-id shorthand of § 1.2 of the roster (`<shorthand>-<vendor>`),
 * which is how a flat id set is grouped back into repositories. `totem` must
 * be matched as a whole shorthand, never as a prefix of `totem-strategy`'s
 * seats — the grouping below splits on the LAST hyphen.
 */
const SHORTHAND: Record<string, string> = {
  totem: 'totem',
  'totem-strategy': 'strategy',
  'liquid-city': 'lc',
  arhgap11: 'arhgap11',
  'totem-status': 'status',
  'totem-playground': 'playground',
};

/** The vendor each column of the table renders, in column order. */
const COLUMNS = ['claude', 'gemini', 'kimi'] as const;

/** The table rows of step 2a: `| \`repo\` | cell | cell | cell |`, one per repo. */
function tableRows(): Array<{ repo: string; cells: string[] }> {
  const rows: Array<{ repo: string; cells: string[] }> = [];
  for (const line of SIGNOFF_SKILL_CONTENT.split('\n')) {
    const match = /^\s*\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (match === null) continue;
    // The header row's first cell is a prose label with a code span in it,
    // not a bare repo name; the data rows carry exactly the repo name.
    if (match[1]!.includes(' ')) continue;
    rows.push({
      repo: match[1]!,
      cells: match[2]!.split('|').map((c) => c.trim()),
    });
  }
  return rows;
}

/** A cell that names a seat is a code span; an italic cell is "no seat here". */
function seatOf(cell: string): string | null {
  const match = /^`([^`]+)`$/.exec(cell);
  return match === null ? null : match[1]!;
}

/** `<shorthand>-<vendor>` split on the LAST hyphen. */
function splitSeat(seat: string): { shorthand: string; vendor: string } {
  const at = seat.lastIndexOf('-');
  return { shorthand: seat.slice(0, at), vendor: seat.slice(at + 1) };
}

const KIMI_SEATS = ['lc-kimi', 'status-kimi', 'strategy-kimi', 'totem-kimi'];

describe('signoff step 2a table ↔ COHORT_AGENT_MAP (mmnto-ai/totem#2865)', () => {
  const rows = tableRows();

  it('parses the table: one row per cohort repo, three vendor cells each', () => {
    expect(rows.map((r) => r.repo)).toEqual(Object.keys(SHORTHAND));
    for (const row of rows) {
      expect(row.cells, row.repo).toHaveLength(3);
    }
  });

  it('every seat sits in ITS repository row and ITS vendor column', () => {
    // A seat filed under the wrong repo or the wrong column keeps a flat set
    // unchanged; the association is what a session reads off the table.
    for (const row of rows) {
      row.cells.forEach((cell, column) => {
        const seat = seatOf(cell);
        if (seat === null) return;
        const { shorthand, vendor } = splitSeat(seat);
        expect(shorthand, `${row.repo} column ${COLUMNS[column]}: ${seat}`).toBe(
          SHORTHAND[row.repo],
        );
        expect(vendor, `${row.repo} column ${COLUMNS[column]}: ${seat}`).toBe(COLUMNS[column]);
      });
    }
  });

  it('per repository, the map seats ⊆ the row, and the row leads the map by exactly its Kimi seat', () => {
    // `knownCohortAgents()` with no workspace is exactly the map's union — no
    // seat dir on this machine can widen it — grouped back by shorthand.
    const mapByRepo = new Map<string, Set<string>>();
    for (const seat of knownCohortAgents()) {
      const { shorthand } = splitSeat(seat);
      const repo = Object.entries(SHORTHAND).find(([, s]) => s === shorthand)?.[0];
      expect(repo, `map seat with no table row: ${seat}`).toBeDefined();
      if (!mapByRepo.has(repo!)) mapByRepo.set(repo!, new Set());
      mapByRepo.get(repo!)!.add(seat);
    }
    const tableOnly: string[] = [];
    for (const row of rows) {
      const inRow = new Set(row.cells.map(seatOf).filter((s): s is string => s !== null));
      const inMap = mapByRepo.get(row.repo) ?? new Set<string>();
      const mapOnly = [...inMap].filter((s) => !inRow.has(s));
      expect(mapOnly, `${row.repo}: map seats the row does not carry`).toEqual([]);
      tableOnly.push(...[...inRow].filter((s) => !inMap.has(s)));
    }
    // The one-directional gap, named: closes to [] when the map's Kimi
    // propagation lands (mmnto-ai/totem#2875), at which point a human empties
    // KIMI_SEATS and this becomes an equality lock.
    expect(tableOnly.sort(), 'seats the table names that the map does not').toEqual(KIMI_SEATS);
  });

  it('the Kimi column names the four seats the roster of record seats (2026-07-18 and 2026-07-29)', () => {
    const kimi = Object.fromEntries(rows.map((r) => [r.repo, seatOf(r.cells[2]!)]));
    expect(kimi).toMatchObject({
      totem: 'totem-kimi',
      'totem-strategy': 'strategy-kimi',
      'liquid-city': 'lc-kimi',
      'totem-status': 'status-kimi',
    });
  });
});
