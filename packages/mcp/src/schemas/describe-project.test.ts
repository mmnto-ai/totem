import { describe, expect, it } from 'vitest';

import {
  DescribeProjectInputSchema,
  DescribeProjectOutputSchema,
  GitStateSchema,
  MilestoneStateSchema,
  RECENT_PRS_COUNT,
  RichProjectStateSchema,
  RuleCountsSchema,
  StrategyPointerSchema,
  UNCOMMITTED_FILES_CAP,
} from './describe-project.js';

describe('DescribeProjectInputSchema', () => {
  it('accepts empty input and defaults includeRichState to false', () => {
    const parsed = DescribeProjectInputSchema.parse({});
    expect(parsed.includeRichState).toBe(false);
  });

  it('accepts explicit includeRichState false', () => {
    const parsed = DescribeProjectInputSchema.parse({ includeRichState: false });
    expect(parsed.includeRichState).toBe(false);
  });

  it('accepts explicit includeRichState true', () => {
    const parsed = DescribeProjectInputSchema.parse({ includeRichState: true });
    expect(parsed.includeRichState).toBe(true);
  });

  it('rejects non-boolean includeRichState', () => {
    expect(() => DescribeProjectInputSchema.parse({ includeRichState: 'yes' })).toThrow();
  });
});

describe('DescribeProjectOutputSchema backward compatibility', () => {
  const legacyShape = {
    project: 'test',
    tier: 'standard' as const,
    rules: 10,
    lessons: 5,
    targets: ['**/*.ts (code/typescript-ast)'],
    partitions: { core: ['packages/core/'] },
    hooks: ['pre-push'],
  };

  it('accepts legacy shape without richState', () => {
    const parsed = DescribeProjectOutputSchema.parse(legacyShape);
    expect(parsed.richState).toBeUndefined();
  });

  it('accepts legacy shape with richState populated', () => {
    const rich = {
      strategyPointer: { sha: 'abc1234', latestJournal: '2026-04-16-session.md' },
      gitState: { branch: 'main', uncommittedFiles: [], truncated: false },
      packageVersions: { '@mmnto/cli': '1.14.10' },
      ruleCounts: { active: 10, archived: 2, nonCompilable: 3 },
      lessonCount: 5,
      testCount: null,
      milestone: { name: '1.15.0', gateTickets: ['#1479'], bestEffort: true as const },
      recentPrs: [{ title: 'feat: foo (#1)', date: '2026-04-16T00:00:00Z', squashSha: 'abcd123' }],
    };
    const parsed = DescribeProjectOutputSchema.parse({ ...legacyShape, richState: rich });
    expect(parsed.richState?.ruleCounts.active).toBe(10);
  });

  it('rejects malformed richState', () => {
    expect(() =>
      DescribeProjectOutputSchema.parse({
        ...legacyShape,
        richState: { strategyPointer: 'not an object' },
      }),
    ).toThrow();
  });
});

describe('GitStateSchema', () => {
  it('accepts null branch (outside git repo)', () => {
    const parsed = GitStateSchema.parse({ branch: null, uncommittedFiles: [], truncated: false });
    expect(parsed.branch).toBeNull();
  });

  it('accepts branch + files + truncation marker', () => {
    const parsed = GitStateSchema.parse({
      branch: 'main',
      uncommittedFiles: ['a.ts', 'b.ts'],
      truncated: true,
    });
    expect(parsed.truncated).toBe(true);
  });
});

describe('RuleCountsSchema', () => {
  it('rejects negative counts', () => {
    expect(() => RuleCountsSchema.parse({ active: -1, archived: 0, nonCompilable: 0 })).toThrow();
  });

  it('rejects non-integer counts', () => {
    expect(() => RuleCountsSchema.parse({ active: 1.5, archived: 0, nonCompilable: 0 })).toThrow();
  });
});

describe('MilestoneStateSchema', () => {
  it('requires bestEffort literal true', () => {
    expect(() =>
      MilestoneStateSchema.parse({ name: null, gateTickets: [], bestEffort: false }),
    ).toThrow();
  });

  it('accepts null name with empty gateTickets', () => {
    const parsed = MilestoneStateSchema.parse({
      name: null,
      gateTickets: [],
      bestEffort: true,
    });
    expect(parsed.name).toBeNull();
  });
});

describe('StrategyPointerSchema', () => {
  it('allows both fields null (no submodule)', () => {
    const parsed = StrategyPointerSchema.parse({ sha: null, latestJournal: null });
    expect(parsed.sha).toBeNull();
  });
});

describe('RichProjectStateSchema', () => {
  it('allows testCount: null explicitly', () => {
    const parsed = RichProjectStateSchema.parse({
      strategyPointer: { sha: null, latestJournal: null },
      gitState: { branch: null, uncommittedFiles: [], truncated: false },
      packageVersions: {},
      ruleCounts: { active: 0, archived: 0, nonCompilable: 0 },
      lessonCount: 0,
      testCount: null,
      milestone: { name: null, gateTickets: [], bestEffort: true },
      recentPrs: [],
    });
    expect(parsed.testCount).toBeNull();
  });
});

describe('constants', () => {
  it('caps match the design doc', () => {
    expect(UNCOMMITTED_FILES_CAP).toBe(50);
    expect(RECENT_PRS_COUNT).toBe(5);
  });
});
