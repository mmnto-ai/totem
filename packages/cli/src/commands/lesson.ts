const TAG = 'Lesson';

// ─── Helpers ───────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

// ─── Subcommands ───────────────────────────────────────

export async function lessonListCommand(): Promise<void> {
  const path = await import('node:path');
  const { hashLesson, readAllLessons } = await import('@mmnto/totem');
  const { log, dim, bold } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);

  const lessons = readAllLessons(totemDir);

  if (lessons.length === 0) {
    log.info(TAG, 'No lessons found. Run `totem lesson add` or `totem extract` to create lessons.');
    return;
  }

  // Table header
  const hashW = 10;
  const headingW = 60;
  const tagsW = 30;

  console.error(dim(`  ${'HASH'.padEnd(hashW)}${'HEADING'.padEnd(headingW)}TAGS`));
  console.error(dim('  ' + '\u2500'.repeat(hashW + headingW + tagsW)));

  for (const lesson of lessons) {
    const hash = hashLesson(lesson.heading, lesson.body).slice(0, 8).padEnd(hashW);
    const heading = truncate(lesson.heading, headingW).padEnd(headingW);
    const tags = truncate(lesson.tags.join(', '), tagsW);

    console.error(`  ${hash}${heading}${tags}`);
  }

  console.error('');
  log.info(TAG, `${bold(String(lessons.length))} lesson(s) total`);
}

export async function lessonAddCommand(text: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { generateLessonHeading, writeLessonFile } = await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { IS_WIN, loadConfig, resolveConfigPath, sanitize } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }

  const lessonsDir = path.join(totemDir, 'lessons');
  const safeText = sanitize(text);
  const heading = generateLessonHeading(safeText);
  const entry = `## Lesson \u2014 ${heading}\n\n**Tags:** manual\n\n${safeText.trim()}\n`;

  const writtenPath = writeLessonFile(lessonsDir, entry);
  const fileName = path.basename(writtenPath);
  log.success('Totem', `Lesson saved to ${config.totemDir}/lessons/${fileName}`); // totem-ignore

  // Trigger incremental sync in background
  function detectSyncCommand(dir: string): { cmd: string; args: string[] } {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
      return {
        cmd: IS_WIN ? 'pnpm.cmd' : 'pnpm',
        args: ['exec', 'totem', 'sync', '--incremental'],
      };
    }
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
      return { cmd: IS_WIN ? 'yarn.cmd' : 'yarn', args: ['totem', 'sync', '--incremental'] };
    }
    return { cmd: IS_WIN ? 'npx.cmd' : 'npx', args: ['totem', 'sync', '--incremental'] };
  }

  const logPath = path.join(totemDir, 'mcp-sync.log');
  log.dim('Totem', 'Triggering background re-index...');
  try {
    const { cmd, args } = detectSyncCommand(cwd);
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      shell: IS_WIN,
      windowsHide: true,
    });
    child.unref();
    fs.closeSync(logFd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Totem', `Failed to trigger background sync: ${message}`);
  }
}
