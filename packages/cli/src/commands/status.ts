const TAG = '[Status]';

export async function statusCommand(): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { safeExec } = await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const configRoot = path.dirname(configPath);
  const config = await loadConfig(configPath);
  const totemDir = path.join(configRoot, config.totemDir);

  // Git state
  let branch = 'unknown';
  let dirty = false;
  try {
    branch = safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const status = safeExec('git', ['status', '--porcelain'], { cwd });
    dirty = status.trim().length > 0;
  } catch {
    // Not a git repo or git unavailable
  }

  // Compile manifest
  let manifestStatus = 'missing';
  let ruleCount = 0;
  try {
    const { readCompileManifest, generateInputHash, loadCompiledRules } =
      await import('@mmnto/totem');

    // Rule count parity (#2388): count the ACTIVE set through the SAME loader
    // lint/describe use — `loadCompiledRules` applies the #1345 status filter
    // (archived / untested-against-codebase / pending-verification excluded).
    // The raw file total would be a third, different number (485 raw vs 387
    // active at the time of this fix). When the compiled-rules file is present
    // and readable, its active count is AUTHORITATIVE — including an honest 0.
    let compiledFileReadable = false;
    try {
      const rulesPath = path.join(totemDir, 'compiled-rules.json');
      if (fs.existsSync(rulesPath)) {
        ruleCount = loadCompiledRules(rulesPath).length;
        compiledFileReadable = true;
      }
      // totem-context: status is a read-only sensor — a malformed compiled-rules.json degrades to the manifest fallback below instead of crashing the whole display; lint's own loader is where malformation fails loud.
    } catch {
      compiledFileReadable = false;
    }

    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = readCompileManifest(manifestPath);
      // Manifest count is the FALLBACK, used only when the compiled-rules file
      // is absent/unreadable — not whenever the active count happens to be 0
      // (an all-archived file should honestly report 0, not a stale manifest
      // number).
      if (!compiledFileReadable) {
        ruleCount = manifest.rule_count;
      }
      const lessonsDir = path.join(totemDir, 'lessons');
      const currentHash = generateInputHash(lessonsDir, cwd);
      manifestStatus = currentHash === manifest.input_hash ? 'fresh' : 'stale';
    }
  } catch {
    manifestStatus = 'error';
  }

  // Lesson count
  let lessonCount = 0;
  try {
    const lessonsDir = path.join(totemDir, 'lessons');
    if (fs.existsSync(lessonsDir)) {
      lessonCount = fs.readdirSync(lessonsDir).filter((f: string) => f.endsWith('.md')).length;
    }
  } catch {
    // lessons dir unreadable
  }

  // Shield flag
  let shieldStatus = 'missing';
  try {
    const flagPath = path.join(totemDir, 'cache', '.shield-passed');
    if (fs.existsSync(flagPath)) {
      const flagSha = fs.readFileSync(flagPath, 'utf-8').trim();
      const head = safeExec('git', ['rev-parse', 'HEAD'], { cwd });
      shieldStatus = flagSha === head ? 'passed' : 'stale';
    }
  } catch {
    shieldStatus = 'error';
  }

  // JSON mode — output structured data and return
  const { isJsonMode, printJson } = await import('../json-output.js');
  if (isJsonMode()) {
    printJson({
      status: 'success',
      command: 'status',
      data: {
        branch,
        dirty,
        rules: ruleCount,
        lessons: lessonCount,
        manifest: manifestStatus,
        shield: shieldStatus,
      },
    });
    return;
  }

  // Print summary
  log.info(TAG, `Branch: ${branch}${dirty ? ' (dirty)' : ''}`);
  log.info(TAG, `Rules: ${ruleCount} compiled`);
  log.info(TAG, `Lessons: ${lessonCount}`);

  if (manifestStatus === 'fresh') {
    log.success(TAG, 'Manifest: fresh');
  } else if (manifestStatus === 'stale') {
    log.warn(TAG, 'Manifest: stale — run `totem compile`');
  } else {
    log.warn(TAG, `Manifest: ${manifestStatus}`);
  }

  if (shieldStatus === 'passed') {
    log.success(TAG, 'Shield: passed');
  } else if (shieldStatus === 'stale') {
    log.warn(TAG, 'Shield: stale (code changed since last pass)');
  } else {
    log.warn(TAG, `Shield: ${shieldStatus}`);
  }
}
