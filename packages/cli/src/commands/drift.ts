import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectDrift, parseLessonsFile } from '@mmnto/totem';

import { bold, errorColor, log, success as successColor } from '../ui.js';
import { loadConfig, resolveConfigPath, sanitize } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Drift';

// ─── Main command ───────────────────────────────────────

export async function driftCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const lessonsPath = path.join(cwd, config.totemDir, 'lessons.md');

  if (!fs.existsSync(lessonsPath)) {
    log.dim(TAG, 'No lessons file found — nothing to check.');
    return;
  }

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lessons = parseLessonsFile(content);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons found — nothing to check.');
    return;
  }

  log.info(TAG, `Scanning ${lessons.length} lesson(s) for stale file references...`);
  const drift = detectDrift(lessons, cwd);

  if (drift.length === 0) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} — All file references in lessons are current.`);
    return;
  }

  // Report stale references
  log.warn(TAG, `Found ${drift.length} lesson(s) with stale file references:\n`);

  for (const result of drift) {
    const heading = sanitize(result.lesson.heading).replace(/\n/g, ' ');
    const refs = result.orphanedRefs.map((r) => `    → ${sanitize(r)}`).join('\n');
    console.error(`  [${result.lesson.index + 1}] ${heading}`);
    console.error(refs);
    console.error('');
  }

  const totalRefs = drift.reduce((sum, d) => sum + d.orphanedRefs.length, 0);
  const label = errorColor(bold('FAIL'));
  log.info(
    TAG,
    `${label} — ${totalRefs} stale reference(s) across ${drift.length} lesson(s). Run \`totem sync --prune\` to fix.`,
  );
  process.exit(1);
}
