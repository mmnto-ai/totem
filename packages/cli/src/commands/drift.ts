// ─── Constants ──────────────────────────────────────────

const TAG = 'Drift';

// ─── Main command ───────────────────────────────────────

export async function driftCommand(): Promise<void> {
  const path = await import('node:path');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');
  const { loadConfig, resolveConfigPath, sanitize } = await import('../utils.js');
  const { detectDrift, readAllLessons, TotemError } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const lessons = readAllLessons(totemDir);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons found — nothing to check.'); // totem-ignore
    return;
  }

  log.info(TAG, `Scanning ${lessons.length} lesson(s) for stale file references...`); // totem-ignore
  const drift = detectDrift(lessons, cwd);

  if (drift.length === 0) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} — All file references in lessons are current.`); // totem-ignore
    return;
  }

  // Report stale references
  log.warn(TAG, `Found ${drift.length} lesson(s) with stale file references:\n`); // totem-ignore

  for (const result of drift) {
    const heading = sanitize(result.lesson.heading).replace(/\n/g, ' ');
    const refs = result.orphanedRefs.map((r) => `    → ${sanitize(r)}`).join('\n');
    console.error(`  [${result.lesson.index + 1}] ${heading}`); // totem-ignore
    console.error(refs);
    console.error('');
  }

  const totalRefs = drift.reduce((sum, d) => sum + d.orphanedRefs.length, 0);
  const label = errorColor(bold('FAIL'));
  log.warn(
    TAG,
    `${label} — ${totalRefs} stale reference(s) across ${drift.length} lesson(s).`, // totem-ignore
  );
  throw new TotemError(
    'DRIFT_FAILED',
    `${totalRefs} stale reference(s) across ${drift.length} lesson(s).`,
    'Run `totem sync --prune` to fix.',
  );
}
