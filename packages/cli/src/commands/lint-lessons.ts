const TAG = '[LintLessons]';

export async function lintLessonsCommand(): Promise<void> {
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const { TotemError, readAllLessons, validateLessons } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);

  const lessons = readAllLessons(totemDir);

  if (lessons.length === 0) {
    throw new TotemError(
      'NO_LESSONS',
      'No lessons found.',
      'Add lessons with `totem extract <pr>` or create .totem/lessons/*.md files manually.',
    );
  }

  log.info(TAG, `Scanning ${lessons.length} lesson(s)...`);

  const result = validateLessons(lessons);

  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');

  for (const d of errors) {
    const src = d.sourcePath ? ` (${d.sourcePath})` : '';
    log.error('Totem Error', `${d.lessonHeading} ${src}: [${d.field}] ${d.message}`);
  }

  for (const d of warnings) {
    const src = d.sourcePath ? ` (${d.sourcePath})` : '';
    log.warn(TAG, `${d.lessonHeading} ${src}: [${d.field}] ${d.message}`);
  }

  if (errors.length > 0) {
    log.error(
      'Totem Error',
      `${errors.length} error(s), ${warnings.length} warning(s) across ${lessons.length} lessons`,
    );
    process.exit(1);
  }

  if (warnings.length > 0) {
    log.warn(TAG, `${warnings.length} warning(s) across ${lessons.length} lessons`);
  }

  log.success(
    TAG,
    `${lessons.length} lessons validated — ${errors.length} errors, ${warnings.length} warnings`,
  );
}
