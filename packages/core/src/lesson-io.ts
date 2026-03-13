import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ParsedLesson } from './drift-detector.js';
import { parseLessonsFile } from './drift-detector.js';

/**
 * Generate a deterministic, idempotent filename for a lesson entry.
 * Format: `lesson-<sha256(content).substring(0,8)>.md`
 */
export function lessonFileName(content: string): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
  return `lesson-${hash}.md`;
}

/**
 * Write a formatted lesson entry to a discrete file in the lessons directory.
 * Creates the directory if missing. Returns the full path of the written file.
 */
export function writeLessonFile(lessonsDir: string, entry: string): string {
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  const fileName = lessonFileName(entry);
  const filePath = path.join(lessonsDir, fileName);
  fs.writeFileSync(filePath, entry.trim() + '\n', 'utf-8');
  return filePath;
}

/**
 * Async version of writeLessonFile for the MCP server.
 */
export async function writeLessonFileAsync(lessonsDir: string, entry: string): Promise<string> {
  await fs.promises.mkdir(lessonsDir, { recursive: true });

  const fileName = lessonFileName(entry);
  const filePath = path.join(lessonsDir, fileName);
  await fs.promises.writeFile(filePath, entry.trim() + '\n', 'utf-8');
  return filePath;
}

/**
 * Dual-read: aggregate lessons from both the legacy `.totem/lessons.md` file
 * and the new `.totem/lessons/*.md` directory. Each lesson gets a `sourcePath`
 * set to its origin file for prune operations.
 */
export function readAllLessons(totemDir: string): ParsedLesson[] {
  const allLessons: ParsedLesson[] = [];

  // 1. Read legacy .totem/lessons.md if it exists
  const legacyPath = path.join(totemDir, 'lessons.md');
  if (fs.existsSync(legacyPath)) {
    const content = fs.readFileSync(legacyPath, 'utf-8');
    const lessons = parseLessonsFile(content);
    for (const lesson of lessons) {
      lesson.sourcePath = legacyPath;
    }
    allLessons.push(...lessons);
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
      const lessons = parseLessonsFile(content);
      for (const lesson of lessons) {
        lesson.sourcePath = filePath;
      }
      allLessons.push(...lessons);
    }
  }

  // Re-index all lessons sequentially
  for (let i = 0; i < allLessons.length; i++) {
    allLessons[i]!.index = i;
  }

  return allLessons;
}
