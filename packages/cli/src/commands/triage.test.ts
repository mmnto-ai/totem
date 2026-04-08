import { describe, expect, it } from 'vitest';

import type { SearchResult } from '@mmnto/totem';

import type { StandardIssueListItem } from '../adapters/issue-adapter.js';
import { assemblePrompt, formatIssueInventory } from './triage.js';

describe('formatIssueInventory', () => {
  it('renders a markdown table with header', () => {
    const issues: StandardIssueListItem[] = [
      { number: 1, title: 'Fix bug', labels: ['bug'], updatedAt: '2026-03-01T00:00:00Z' },
      {
        number: 2,
        title: 'Add feature',
        labels: ['enhancement', 'P2'],
        updatedAt: '2026-03-02T12:00:00Z',
      },
    ];
    const output = formatIssueInventory(issues);
    expect(output).toContain('| Issue | Title | Labels | Updated |');
    expect(output).toContain('|---|---|---|---|');
    expect(output).toContain('| #1 | Fix bug | bug | 2026-03-01 |');
    expect(output).toContain('| #2 | Add feature | enhancement, P2 | 2026-03-02 |');
  });

  it('shows (none) for issues without labels', () => {
    const issues: StandardIssueListItem[] = [
      { number: 5, title: 'No labels', labels: [], updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const output = formatIssueInventory(issues);
    expect(output).toContain('(none)');
  });

  it('returns header-only table for empty issue list', () => {
    const output = formatIssueInventory([]);
    const lines = output.split('\n');
    expect(lines).toHaveLength(2); // header + separator
  });
});

// ─── assemblePrompt ──────────────────────────────────────

describe('assemblePrompt', () => {
  const issues: StandardIssueListItem[] = [
    { number: 1, title: 'Fix bug', labels: ['bug'], updatedAt: '2026-03-01T00:00:00Z' },
  ];

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
    const result = assemblePrompt(issues, context, 'SYSTEM');
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('Test trap');
    // Condensed mode: no score display
    expect(result).not.toContain('score:');
  });

  it('omits lesson section when no lessons', () => {
    const context = { specs: [], sessions: [], lessons: [] };
    const result = assemblePrompt(issues, context, 'SYSTEM');
    expect(result).not.toContain('RELEVANT LESSONS');
  });
});
