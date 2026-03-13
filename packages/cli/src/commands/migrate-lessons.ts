import * as fs from 'node:fs'; // totem-ignore
import * as path from 'node:path'; // totem-ignore

import { parseLessonsFile, writeLessonFile } from '@mmnto/totem'; // totem-ignore

import { BASELINE_MARKER } from '../assets/universal-lessons.js'; // totem-ignore
import { log } from '../ui.js'; // totem-ignore
import { loadConfig, resolveConfigPath } from '../utils.js'; // totem-ignore

const TAG = 'Migrate';

/**
 * Migrate from `.totem/lessons.md` (single file) to `.totem/lessons/` (directory of discrete files).
 *
 * 1. Read `.totem/lessons.md`
 * 2. Parse with `parseLessonsFile(content)`
 * 3. For each lesson: `writeLessonFile(lessonsDir, lesson.raw)`
 * 4. Handle baseline: if content contains `BASELINE_MARKER`, write preamble + baseline lessons to `baseline.md`
 * 5. Rename `.totem/lessons.md` → `.totem/lessons.md.bak` (safety)
 * 6. Log summary
 */
export async function migrateLessonsCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const legacyPath = path.join(totemDir, 'lessons.md');
  const lessonsDir = path.join(totemDir, 'lessons');

  if (!fs.existsSync(legacyPath)) {
    log.dim(TAG, 'No .totem/lessons.md found — nothing to migrate.'); // totem-ignore
    return;
  }

  const content = fs.readFileSync(legacyPath, 'utf-8');
  const lessons = parseLessonsFile(content);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons found in .totem/lessons.md — nothing to migrate.'); // totem-ignore
    return;
  }

  log.info(TAG, `Found ${lessons.length} lesson(s) in .totem/lessons.md`); // totem-ignore

  // Create lessons directory
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  let baselineCount = 0;
  let lessonCount = 0;

  const markerMatch = content.match(
    // totem-ignore — only one baseline marker expected per file
    new RegExp(`^${BASELINE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'),
  );
  if (markerMatch && markerMatch.index != null) {
    // Extract baseline section: everything from the line-start marker to end of file
    const markerIdx = markerMatch.index;
    const preMarker = content.slice(0, markerIdx);
    const baselineLessons = parseLessonsFile(content.slice(markerIdx));
    const nonBaselineLessons = parseLessonsFile(preMarker);

    // Write baseline lessons to baseline.md
    if (baselineLessons.length > 0) {
      const baselineContent =
        BASELINE_MARKER + '\n\n' + baselineLessons.map((l) => l.raw).join('\n');
      fs.writeFileSync(
        path.join(lessonsDir, 'baseline.md'),
        baselineContent.trim() + '\n',
        'utf-8',
      );
      baselineCount = baselineLessons.length;
    }

    // Write non-baseline lessons as individual files
    for (const lesson of nonBaselineLessons) {
      writeLessonFile(lessonsDir, lesson.raw);
      lessonCount++;
    }
  } else {
    // No baseline — write all lessons as individual files
    for (const lesson of lessons) {
      writeLessonFile(lessonsDir, lesson.raw);
      lessonCount++;
    }
  }

  // Rename legacy file
  const bakPath = legacyPath + '.bak';
  fs.renameSync(legacyPath, bakPath);

  log.success(
    TAG,
    `Migrated ${lessonCount} lesson(s)${baselineCount > 0 ? ` + ${baselineCount} baseline` : ''} to ${config.totemDir}/lessons/`, // totem-ignore
  );
  log.dim(TAG, `Legacy file backed up to ${config.totemDir}/lessons.md.bak`); // totem-ignore
  log.dim(TAG, 'Run `totem sync` to re-index.');
}
