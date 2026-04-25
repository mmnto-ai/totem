/**
 * Role-of-code applicability filter for lessons (strategy item 020).
 *
 * Pure utility for narrowing a lesson list to those whose declared
 * `appliesTo` roles match the role of the function/file under review.
 * Lessons declared `['any']` always pass; the filter is opt-in via the
 * `targetRole` argument so callers without a role classification get
 * the full list back unchanged.
 */

import type { LessonRole } from './types.js';

/** Minimal lesson shape this filter operates on. */
export interface LessonWithAppliesTo {
  appliesTo: LessonRole[];
}

/**
 * Return lessons whose `appliesTo` includes `targetRole` OR `'any'`.
 *
 * If `targetRole` is omitted (or undefined), returns the input unchanged —
 * caller has not classified the surface and the filter is a no-op.
 *
 * Pure: does not mutate the input array or its elements.
 */
export function filterLessonsByRole<T extends LessonWithAppliesTo>(
  lessons: readonly T[],
  targetRole?: LessonRole,
): T[] {
  if (targetRole === undefined) {
    return lessons.slice();
  }
  return lessons.filter(
    (lesson) => lesson.appliesTo.includes(targetRole) || lesson.appliesTo.includes('any'),
  );
}
