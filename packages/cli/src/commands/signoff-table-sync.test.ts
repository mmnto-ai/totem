/**
 * The signoff skill's step-2a cohort table and core's `COHORT_AGENT_MAP` are
 * two copies of one bootstrap fallback (Proposal 282 § Scope item 3), and each
 * says it is kept in sync with the other. Nothing held them to it: the three
 * Kimi seats read "not seated" in the table for weeks after they were seated
 * (mmnto-ai/totem#2865). This lock holds the two RENDERINGS in this repository
 * to each other so a seat added to one copy alone fails here rather than in a
 * poll.
 *
 * TODAY the table LEADS the map by exactly the four Kimi seats the roster of
 * record seats (`doctrine/cohort-roles.md` § 1.1 in the strategy repository,
 * which this test cannot read and does not claim to): the map's Kimi
 * propagation moves the mail-accounting fixtures and is its own change,
 * mmnto-ai/totem#2875. When the map gains them, `tableOnly` below becomes
 * empty and the assertion tightens to equality.
 */
import { describe, expect, it } from 'vitest';

import { knownCohortAgents } from '@mmnto/totem';

import { SIGNOFF_SKILL_CONTENT } from './init-templates.js';

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

const KIMI_SEATS = ['lc-kimi', 'status-kimi', 'strategy-kimi', 'totem-kimi'];

describe('signoff step 2a table ↔ COHORT_AGENT_MAP (mmnto-ai/totem#2865)', () => {
  const rows = tableRows();

  it('parses the table: one row per cohort repo, three vendor cells each', () => {
    expect(rows.map((r) => r.repo)).toEqual([
      'totem',
      'totem-strategy',
      'liquid-city',
      'arhgap11',
      'totem-status',
      'totem-playground',
    ]);
    for (const row of rows) {
      expect(row.cells, row.repo).toHaveLength(3);
    }
  });

  it('every seat the map carries is in the table, and the table leads the map by exactly the four Kimi seats', () => {
    const inTable = new Set<string>();
    for (const row of rows) {
      for (const cell of row.cells) {
        const seat = seatOf(cell);
        if (seat !== null) inTable.add(seat);
      }
    }
    // `knownCohortAgents()` with no workspace is exactly the map's union —
    // no seat dir on this machine can widen it.
    const inMap = new Set(knownCohortAgents());
    const mapOnly = [...inMap].filter((s) => !inTable.has(s)).sort();
    const tableOnly = [...inTable].filter((s) => !inMap.has(s)).sort();
    expect(mapOnly, 'seats the map carries that the table does not').toEqual([]);
    // The one-directional gap, named: closes to [] when the map's Kimi
    // propagation lands, at which point this becomes an equality lock.
    expect(tableOnly, 'seats the table names that the map does not').toEqual(KIMI_SEATS);
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
