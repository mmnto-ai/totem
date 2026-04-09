import { describe, expect, it } from 'vitest';

import type { SearchResult } from '@mmnto/totem';

import type { StandardPrListItem } from '../adapters/pr-adapter.js';
import { assemblePrompt, formatPRList } from './briefing.js';

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

// ─── assemblePrompt ──────────────────────────────────────

describe('assemblePrompt', () => {
  const makeLesson = (label: string): SearchResult => ({
    content: 'Lesson content here',
    contextPrefix: '',
    filePath: '.totem/lessons.md',
    absoluteFilePath: '.totem/lessons.md',
    type: 'spec',
    label,
    score: 0.9,
    metadata: {},
  });

  it('includes condensed lesson section when lessons are present', () => {
    const context = { specs: [], sessions: [], lessons: [makeLesson('Test trap')] };
    const result = assemblePrompt('main', '', [], context, 'SYSTEM');
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('Test trap');
    // Condensed mode: no score display
    expect(result).not.toContain('score:');
  });

  it('omits lesson section when no lessons', () => {
    const context = { specs: [], sessions: [], lessons: [] };
    const result = assemblePrompt('main', '', [], context, 'SYSTEM');
    expect(result).not.toContain('RELEVANT LESSONS');
  });

  it('includes git state and PR info', () => {
    const prs: StandardPrListItem[] = [{ number: 42, title: 'Widget', headRefName: 'feat/widget' }];
    const context = { specs: [], sessions: [], lessons: [] };
    const result = assemblePrompt('feat/widget', 'M src/index.ts', prs, context, 'SYSTEM');
    expect(result).toContain('Branch: feat/widget');
    expect(result).toContain('#42');
  });
});
