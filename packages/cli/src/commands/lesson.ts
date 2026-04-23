import type { CompiledRule } from '@mmnto/totem';

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
    log.info(
      TAG,
      'No lessons found. Run `totem lesson add` or `totem lesson extract` to create lessons.',
    );
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
  log.success(TAG, `Lesson saved to ${config.totemDir}/lessons/${fileName}`);

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
  log.dim(TAG, 'Triggering background re-index...');
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
    log.warn(TAG, `Failed to trigger background sync: ${message}`);
  }
}

/**
 * Archive a compiled rule by flipping its `status` to `'archived'`, setting
 * the `archivedReason`, stamping `archivedAt` on first transition, and
 * refreshing the compile manifest so `totem verify-manifest` passes on the
 * next push (mmnto-ai/totem#1587).
 *
 * Atomic surface matches `rulePromoteCommand` (rule.ts:300-394): preflight
 * the manifest read BEFORE mutating compiled-rules.json so a missing or
 * corrupt manifest fails loud without leaving the rules file half-written.
 * Tmp-file + rename on the rules write prevents torn writes if the process
 * crashes mid-save.
 *
 * Idempotent on rerun. First archive transition owns `archivedAt`;
 * subsequent invocations refresh `archivedReason` only. Matches the
 * canonical archive-script pattern standardized in mmnto-ai/totem#1625.
 *
 * Supersedes the hand-rolled `scripts/archive-bad-postmerge-*.cjs` pattern
 * for postmerge curation; the `/postmerge` skill calls this command
 * directly after Task 4 of mmnto-ai/totem#1587 ships.
 */
export async function lessonArchiveCommand(id: string, opts: { reason?: string }): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const {
    exportLessons,
    generateOutputHash,
    hashLesson,
    loadCompiledRulesFile,
    readAllLessons,
    readCompileManifest,
    writeCompileManifest,
  } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

  if (!fs.existsSync(rulesPath)) {
    log.error('Totem Error', `No compiled-rules.json at ${rulesPath}. Run 'totem compile' first.`);
    process.exitCode = 1;
    return;
  }

  const rulesFile = loadCompiledRulesFile(rulesPath);
  const matches = rulesFile.rules.filter((r: CompiledRule) =>
    r.lessonHash.toLowerCase().startsWith(id.toLowerCase()),
  );

  if (matches.length === 0) {
    log.error('Totem Error', `No rule found matching '${id}'`);
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    log.warn(TAG, `Ambiguous prefix '${id}' matches ${matches.length} rules:`);
    for (const m of matches) {
      log.info(TAG, `  ${bold(m.lessonHash)} — ${m.lessonHeading}`);
    }
    log.dim(TAG, 'Provide more characters to disambiguate.');
    process.exitCode = 1;
    return;
  }

  const rule = matches[0]!;

  // Preflight the manifest read BEFORE mutating rules.json (mmnto-ai/
  // totem#1601 CR pattern on rulePromoteCommand). Missing / corrupt /
  // unwritable manifest must fail out before any side effects on the
  // rules file.
  const compileManifest = readCompileManifest(manifestPath);

  // Idempotent lifecycle transition: first archive owns archivedAt;
  // reruns refresh archivedReason but leave archivedAt untouched. Matches
  // the canonical archive-script shape standardized in mmnto-ai/totem#1625.
  const wasAlreadyArchived = rule.status === 'archived';
  rule.status = 'archived';
  rule.archivedReason = opts.reason ?? 'Archived via `totem lesson archive`';
  if (!rule.archivedAt) {
    rule.archivedAt = new Date().toISOString();
  }

  // Atomic tmp+rename write matching the canonical on-disk format used
  // by compile-lesson.ts, rule-mutator.ts, and rulePromoteCommand.
  const tmpPath = `${rulesPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(rulesFile, null, 2) + '\n', { encoding: 'utf-8' });
  fs.renameSync(tmpPath, rulesPath);

  // Refresh the manifest's output_hash so verify-manifest passes on the
  // next push. Uses the compileManifest loaded above (preflighted) so the
  // mutation order is: read-manifest -> mutate-rules -> write-rules ->
  // update-manifest.
  compileManifest.output_hash = generateOutputHash(rulesPath);
  compileManifest.compiled_at = new Date().toISOString();
  writeCompileManifest(manifestPath, compileManifest);

  // Regenerate exports so the archived rule gets filtered out of
  // copilot-instructions.md and junie rules.md (mirrors the compile.ts
  // mmnto-ai/totem#1345 export-path filter). No-op if no exports are
  // configured.
  if (config.exports && Object.keys(config.exports).length > 0) {
    const lessons = readAllLessons(totemDir);
    const archivedHashes = new Set(
      rulesFile.rules
        .filter((r: CompiledRule) => r.status === 'archived')
        .map((r: CompiledRule) => r.lessonHash.toLowerCase()),
    );
    const lessonsForExport =
      archivedHashes.size === 0
        ? lessons
        : lessons.filter((l) => !archivedHashes.has(hashLesson(l.heading, l.body).toLowerCase()));
    for (const [name, filePath] of Object.entries(config.exports)) {
      const absPath = path.join(cwd, filePath);
      exportLessons(lessonsForExport, absPath);
      log.dim(TAG, `Exported ${lessonsForExport.length} rules to ${filePath} (${name})`);
    }
  }

  const verb = wasAlreadyArchived ? 'Refreshed archive' : 'Archived';
  log.success(TAG, `${verb} for rule ${bold(rule.lessonHash)} — ${rule.lessonHeading}`);
  log.dim(TAG, 'Manifest refreshed. `totem verify-manifest` should pass.');
}
