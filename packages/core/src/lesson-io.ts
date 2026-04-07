import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ParsedLesson } from './drift-detector.js';
import { parseLessonsFile } from './drift-detector.js';
import { truncateHeading } from './lesson-format.js';
import { buildFrontmatterFromLegacy, extractFrontmatter } from './lesson-frontmatter.js';

/**
 * Generate a deterministic, idempotent filename for a lesson entry.
 * Format: `lesson-<sha256(content).substring(0,8)>.md`
 */
export function lessonFileName(content: string): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
  return `lesson-${hash}.md`;
}

/**
 * Enforce heading length limit on a lesson entry string.
 * Applies truncateHeading() to any `## Lesson [—|–|-] ...` heading that exceeds the limit.
 *
 * Accepts em-dash, en-dash, and hyphen separators (matching the parser as of #1263)
 * AND normalizes the output to canonical em-dash on write — entries written through
 * this function persist to disk in canonical form regardless of the input separator.
 * This mirrors the write-side normalization in `rewriteLessonsFile`.
 */
function enforceHeadingLimit(entry: string): string {
  return entry.replace(/^## Lesson [—–-] (.+)$/m, (_match, heading: string) => {
    return `## Lesson — ${truncateHeading(heading) || 'Lesson'}`; // canonical em-dash on write
  });
}

/** Shared preparation: enforce heading limit, compute filename and content. */
function prepareLessonForWrite(entry: string): { fileName: string; content: string } {
  const sanitized = enforceHeadingLimit(entry);
  return { fileName: lessonFileName(sanitized), content: sanitized.trim() + '\n' };
}

/**
 * Write a formatted lesson entry to a discrete file in the lessons directory.
 * Creates the directory if missing. Returns the full path of the written file.
 */
export function writeLessonFile(lessonsDir: string, entry: string): string {
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  const { fileName, content } = prepareLessonForWrite(entry);
  const filePath = path.join(lessonsDir, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Async version of writeLessonFile for the MCP server.
 */
export async function writeLessonFileAsync(lessonsDir: string, entry: string): Promise<string> {
  await fs.promises.mkdir(lessonsDir, { recursive: true });

  const { fileName, content } = prepareLessonForWrite(entry);
  const filePath = path.join(lessonsDir, fileName);
  await fs.promises.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Dual-read: aggregate lessons from both the legacy `.totem/lessons.md` file
 * and the new `.totem/lessons/*.md` directory. Each lesson gets a `sourcePath`
 * set to its origin file for prune operations.
 */
export function readAllLessons(totemDir: string, onWarn?: (msg: string) => void): ParsedLesson[] {
  const allLessons: ParsedLesson[] = [];

  // 1. Read legacy .totem/lessons.md if it exists
  const legacyPath = path.join(totemDir, 'lessons.md');
  if (fs.existsSync(legacyPath)) {
    const content = fs.readFileSync(legacyPath, 'utf-8');
    const lessons = parseLessonsFile(content);
    for (const lesson of lessons) {
      lesson.frontmatter = buildFrontmatterFromLegacy(lesson.tags, lesson.raw);
      lesson.sourcePath = legacyPath;
    }
    allLessons.push(...lessons);

    // #1263: warn if a non-empty file produced zero parsed lessons (e.g. unsupported
    // separator, malformed heading, missing `## Lesson` markers entirely).
    if (onWarn && lessons.length === 0 && content.trim().length > 0) {
      onWarn(`${legacyPath}: no '## Lesson [—|–|-] ' headings found — file was skipped`);
    }
  }

  // 2. Read .totem/lessons/*.md (sorted, skip non-.md)
  const lessonsDir = path.join(totemDir, 'lessons');
  if (fs.existsSync(lessonsDir) && fs.statSync(lessonsDir).isDirectory()) {
    const files = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const file of files) {
      const filePath = path.join(lessonsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lessonsBefore = allLessons.length;

      // ADR-070: detect YAML frontmatter for individual lesson files
      const warn = onWarn ? (msg: string) => onWarn(`${filePath}: ${msg}`) : undefined;
      const { frontmatter, body: strippedBody, validYaml } = extractFrontmatter(content, warn);

      if (validYaml) {
        const lessons = parseLessonsFile(strippedBody);
        for (const lesson of lessons) {
          lesson.frontmatter = frontmatter;
          // YAML tags are the source of truth (copy to avoid shared reference)
          lesson.tags = [...frontmatter.tags];
          lesson.sourcePath = filePath;
        }
        allLessons.push(...lessons);
      } else {
        // No YAML or invalid YAML — fall back to legacy field mapping
        const legacyContent = strippedBody !== content ? strippedBody : content;
        const lessons = parseLessonsFile(legacyContent);
        for (const lesson of lessons) {
          lesson.frontmatter = buildFrontmatterFromLegacy(lesson.tags, lesson.raw);
          lesson.sourcePath = filePath;
        }
        allLessons.push(...lessons);
      }

      // #1263: warn if a non-empty file produced zero parsed lessons (e.g. unsupported
      // separator, malformed heading, missing `## Lesson` markers entirely). Pre-#1263
      // these files were silently dropped — totem-playground discovered hyphen-formatted
      // lessons had been ignored for weeks before the bug was caught.
      if (onWarn && allLessons.length === lessonsBefore && content.trim().length > 0) {
        onWarn(`${filePath}: no '## Lesson [—|–|-] ' headings found — file was skipped`);
      }
    }
  }

  // Re-index all lessons sequentially
  for (let i = 0; i < allLessons.length; i++) {
    allLessons[i]!.index = i;
  }

  return allLessons;
}
