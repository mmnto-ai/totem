import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { log } from '../ui.js';
import { IS_WIN, loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

function detectSyncCommand(cwd: string): { cmd: string; args: string[] } {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return { cmd: IS_WIN ? 'pnpm.cmd' : 'pnpm', args: ['exec', 'totem', 'sync', '--incremental'] };
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return { cmd: IS_WIN ? 'yarn.cmd' : 'yarn', args: ['totem', 'sync', '--incremental'] };
  }
  return { cmd: IS_WIN ? 'npx.cmd' : 'npx', args: ['totem', 'sync', '--incremental'] };
}

export async function anchorCommand(lessonArg?: string): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }

  const lessonsPath = path.join(totemDir, 'lessons.md');

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
    log.error('Totem', 'Lesson text cannot be empty.');
    return;
  }

  const timestamp = new Date().toISOString();
  const tagString = tags.length > 0 ? tags.join(', ') : 'manual';

  const entry = `\n## Lesson — ${timestamp}\n\n**Tags:** ${tagString}\n\n${lessonText.trim()}\n`;

  fs.appendFileSync(lessonsPath, entry, 'utf-8');
  log.success('Totem', `Lesson saved to ${config.totemDir}/lessons.md`);

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
  } catch (err) {
    log.warn('Totem', `Failed to trigger background sync: ${err}`);
  }
}
