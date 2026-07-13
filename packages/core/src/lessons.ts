/**
 * `@mmnto/totem/lessons` — supported lesson read/write entry point.
 *
 * Curated, semver-tracked re-export of the bounded lesson-authoring surface:
 * directory-based lesson I/O, ADR-070 frontmatter parse/build, the lesson
 * role + frontmatter schema contracts, the role-applicability filter, and the
 * retirement ledger. `ParsedLesson` is included so `readAllLessons`' return
 * type is nameable by consumers.
 *
 * Deliberately bounded: this is the read/write + frontmatter + role/schema
 * surface, NOT the rule compiler. The frozen legacy compiler
 * (`compileLesson`, `compiler.js`) is not exposed as a new public contract
 * here — see mmnto-ai/totem#2336. Lesson formatting/linting helpers
 * (`lesson-format`, `lesson-linter`) also stay off this surface to keep the
 * promise small.
 *
 * Every name here is also re-exported from the legacy root barrel (`.`).
 * Additive per mmnto-ai/totem#2336 (ADR-084 / Proposal 294). The root barrel
 * is unchanged; nothing is removed from it in this cut.
 */

// Directory-based lesson I/O.
export {
  lessonFileName,
  readAllLessons,
  writeLessonFile,
  writeLessonFileAsync,
} from './lesson-io.js';

// Parsed-lesson shape — the element type `readAllLessons` returns.
export type { ParsedLesson } from './drift-detector.js';

// Frontmatter parse/build (ADR-070).
export type { FrontmatterParseResult } from './lesson-frontmatter.js';
export { buildFrontmatterFromLegacy, extractFrontmatter } from './lesson-frontmatter.js';

// Lesson role + frontmatter schema contracts.
export type { LessonFrontmatter, LessonRole } from './types.js';
export { LessonFrontmatterSchema, LessonRoleSchema } from './types.js';

// Role-applicability filter.
export type { LessonWithAppliesTo } from './lesson-role-filter.js';
export { filterLessonsByRole } from './lesson-role-filter.js';

// Retirement ledger (#1165) — lesson lifecycle read/write.
export type { RetiredLesson } from './retired-lessons.js';
export {
  isRetiredHeading,
  readRetiredLessons,
  RETIRED_LESSONS_FILE,
  retireLesson,
  writeRetiredLessons,
} from './retired-lessons.js';
