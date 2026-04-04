import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ─────────────────────────────────────────

export type RetiredLesson = {
  heading: string;
  reason: string;
  retiredAt: string;
};

export type RetiredLessonsFile = RetiredLesson[];

// ─── Constants ─────────────────────────────────────

export const RETIRED_LESSONS_FILE = 'retired-lessons.json';

// ─── Read / Write ──────────────────────────────────

/**
 * Read the retirement ledger from `.totem/retired-lessons.json`.
 * Returns an empty array when the file is missing or contains malformed JSON.
 */
export function readRetiredLessons(totemDir: string): RetiredLesson[] {
  const filePath = path.join(totemDir, RETIRED_LESSONS_FILE);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed as RetiredLesson[];
  } catch {
    return [];
  }
}

/**
 * Write the retirement ledger to `.totem/retired-lessons.json`.
 */
export function writeRetiredLessons(totemDir: string, entries: RetiredLesson[]): void {
  const filePath = path.join(totemDir, RETIRED_LESSONS_FILE);
  fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

// ─── Retire ────────────────────────────────────────

/**
 * Append a retirement entry, deduplicating by heading (case-insensitive exact match).
 * If the heading already exists the entry is not duplicated.
 */
export function retireLesson(totemDir: string, heading: string, reason: string): void {
  const existing = readRetiredLessons(totemDir);
  const normalised = heading.toLowerCase();
  const alreadyExists = existing.some((e) => e.heading.toLowerCase() === normalised);
  if (alreadyExists) return;

  existing.push({
    heading,
    reason,
    retiredAt: new Date().toISOString(),
  });
  writeRetiredLessons(totemDir, existing);
}

// ─── Query ─────────────────────────────────────────

/**
 * Check whether a heading matches any retired entry.
 *
 * Uses case-insensitive substring matching: normalise both sides to lowercase
 * and check if either contains the other. This handles minor rewording by the LLM.
 */
export function isRetiredHeading(heading: string, retired: RetiredLesson[]): boolean {
  const h = heading.toLowerCase();
  return retired.some((entry) => {
    const r = entry.heading.toLowerCase();
    return h.includes(r) || r.includes(h);
  });
}
