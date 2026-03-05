import { describe, expect, it } from 'vitest';

import type { StandardPrListItem } from '../adapters/pr-adapter.js';

import { formatPRList } from './briefing.js';

describe('formatPRList', () => {
  it('returns (none) for empty PR list', () => {
    expect(formatPRList([])).toBe('(none)');
  });

  it('formats a single PR with number, title, and branch', () => {
    const prs: StandardPrListItem[] = [
      { number: 42, title: 'Add widget', headRefName: 'feat/widget' },
    ];
    const output = formatPRList(prs);
    expect(output).toBe('- #42 — Add widget (branch: feat/widget)');
  });

  it('formats multiple PRs as a bulleted list', () => {
    const prs: StandardPrListItem[] = [
      { number: 1, title: 'First', headRefName: 'feat/first' },
      { number: 2, title: 'Second', headRefName: 'feat/second' },
    ];
    const output = formatPRList(prs);
    const lines = output.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('#1');
    expect(lines[1]).toContain('#2');
  });
});
