const TAG = 'AddLesson';

export async function addLessonCommand(lessonArg?: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { stdin: input, stdout: output } = await import('node:process');
  const readline = await import('node:readline/promises');
  const { generateLessonHeading, writeLessonFile } = await import('@mmnto/totem'); // totem-ignore
  const { log } = await import('../ui.js');
  const { IS_WIN, isGlobalConfigPath, loadConfig, loadEnv, resolveConfigPath, sanitize } =
    await import('../utils.js');

  function detectSyncCommand(cwd: string): { cmd: string; args: string[] } {
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
      return {
        cmd: IS_WIN ? 'pnpm.cmd' : 'pnpm',
        args: ['exec', 'totem', 'sync', '--incremental'],
      };
    }
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
      return { cmd: IS_WIN ? 'yarn.cmd' : 'yarn', args: ['totem', 'sync', '--incremental'] };
    }
    return { cmd: IS_WIN ? 'npx.cmd' : 'npx', args: ['totem', 'sync', '--incremental'] };
  }

  const { loadCustomSecrets, maskSecrets } = await import('@mmnto/totem'); // totem-ignore

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  if (isGlobalConfigPath(configPath)) {
    const { TotemConfigError } = await import('@mmnto/totem');
    throw new TotemConfigError(
      'Cannot add lessons without a local project.',
      "Run 'totem init' to create a local .totem/ directory first.",
      'CONFIG_MISSING',
    );
  }
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Load user-defined custom secrets for DLP (#921)
  const customSecrets = loadCustomSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));

  const totemDir = path.join(cwd, config.totemDir);
  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }

  const lessonsDir = path.join(totemDir, 'lessons');

  let lessonText = lessonArg;
  const tags: string[] = [];

  if (!lessonText) {
    const rl = readline.createInterface({ input, output });
    try {
      console.log('--- Proactive Anchoring ---');
      const context = await rl.question('> Context (e.g., Attempting to persist state...): ');
      const symptom = await rl.question('> Symptom (e.g., App crashes on reload...): ');
      const fix = await rl.question('> Fix/Rule (e.g., Use custom localStorage wrappers...): ');
      const tagStr = await rl.question('> Tags (comma separated): ');

      if (tagStr.trim()) {
        tags.push(
          ...tagStr
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        );
      }

      const parts: string[] = [];
      if (context.trim()) parts.push(`**Context:** ${context.trim()}`);
      if (symptom.trim()) parts.push(`**Symptom:** ${symptom.trim()}`);
      if (fix.trim()) parts.push(`**Fix/Rule:** ${fix.trim()}`);

      lessonText = parts.join('\n');
    } finally {
      rl.close();
    }
  }

  if (!lessonText || !lessonText.trim()) {
    log.error('Totem Error', 'Lesson text cannot be empty.');
    return;
  }

  // Warn and redact if lesson text contains custom secret patterns (#921)
  if (customSecrets.length > 0) {
    const redacted = maskSecrets(lessonText, customSecrets);
    if (redacted !== lessonText) {
      log.warn(
        TAG,
        'Custom secret pattern detected in lesson text. The text will be automatically redacted.',
      );
      lessonText = redacted;
    }
  }

  const safeLesson = sanitize(lessonText);
  const safeTagString =
    tags.length > 0 ? tags.map((t) => sanitize(t).replace(/\n/g, ' ')).join(', ') : 'manual';
  const heading = generateLessonHeading(safeLesson);

  const entry = `## Lesson — ${heading}\n\n**Tags:** ${safeTagString}\n\n${safeLesson.trim()}\n`;

  const writtenPath = writeLessonFile(lessonsDir, entry);
  const fileName = path.basename(writtenPath);
  log.success('Totem', `Lesson saved to ${config.totemDir}/lessons/${fileName}`); // totem-ignore

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
