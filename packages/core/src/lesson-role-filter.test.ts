import { describe, expect, it } from 'vitest';

import { filterLessonsByRole, type LessonWithAppliesTo } from './lesson-role-filter.js';

const make = (appliesTo: LessonWithAppliesTo['appliesTo']): LessonWithAppliesTo => ({ appliesTo });

describe('filterLessonsByRole', () => {
  it('returns input unchanged when targetRole is undefined', () => {
    const lessons = [make(['mutator']), make(['boundary']), make(['any'])];
    const result = filterLessonsByRole(lessons);
    expect(result).toHaveLength(3);
    expect(result).toEqual(lessons);
  });

  it('keeps lessons whose appliesTo includes the target role', () => {
    const mutator = make(['mutator']);
    const boundary = make(['boundary']);
    const result = filterLessonsByRole([mutator, boundary], 'mutator');
    expect(result).toEqual([mutator]);
  });

  it("keeps lessons declared 'any' regardless of target role", () => {
    const mutator = make(['mutator']);
    const any = make(['any']);
    const result = filterLessonsByRole([mutator, any], 'boundary');
    expect(result).toEqual([any]);
  });

  it('keeps lessons whose multi-role appliesTo includes the target', () => {
    const mutatorBoundary = make(['mutator', 'boundary']);
    const aggregator = make(['aggregator']);
    const result = filterLessonsByRole([mutatorBoundary, aggregator], 'boundary');
    expect(result).toEqual([mutatorBoundary]);
  });

  it('returns empty array when no lessons match and none are any-tagged', () => {
    const lessons = [make(['mutator']), make(['boundary'])];
    expect(filterLessonsByRole(lessons, 'aggregator')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const lessons = [make(['mutator']), make(['boundary'])];
    const snapshot = lessons.slice();
    filterLessonsByRole(lessons, 'mutator');
    expect(lessons).toEqual(snapshot);
  });

  it('returns a new array instance (no aliasing) when targetRole is undefined', () => {
    const lessons = [make(['mutator'])];
    const result = filterLessonsByRole(lessons);
    expect(result).not.toBe(lessons);
    expect(result).toEqual(lessons);
  });

  it('handles empty input', () => {
    expect(filterLessonsByRole([], 'mutator')).toEqual([]);
    expect(filterLessonsByRole([])).toEqual([]);
  });

  it('preserves additional lesson fields beyond appliesTo', () => {
    type Lesson = LessonWithAppliesTo & { id: string };
    const lessons: Lesson[] = [
      { id: 'a', appliesTo: ['mutator'] },
      { id: 'b', appliesTo: ['any'] },
    ];
    const result = filterLessonsByRole(lessons, 'mutator');
    expect(result.map((l) => l.id)).toEqual(['a', 'b']);
  });
});
