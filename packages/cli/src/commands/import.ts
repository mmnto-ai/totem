import type { CompiledRule } from '@mmnto/totem';

const TAG = 'Import';
const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Types ──────────────────────────────────────────

export interface ImportOptions {
  fromSemgrep?: string;
  fromEslint?: string;
  out?: string;
  dryRun?: boolean;
}

// ─── Main command ───────────────────────────────────

export async function importCommand(options: ImportOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const { loadCompiledRulesFile, saveCompiledRulesFile } = await import('@mmnto/totem');

  // 1. Validate: at least one --from-* flag required
  if (!options.fromSemgrep && !options.fromEslint) {
    log.error('Totem Error', 'At least one --from-semgrep or --from-eslint flag is required.');
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = options.out ?? path.join(totemDir, COMPILED_RULES_FILE);

  const importedRules: CompiledRule[] = [];
  const allSkipped: { id: string; reason: string }[] = [];

  // 2. Process Semgrep rules
  if (options.fromSemgrep) {
    const semgrepPath = path.resolve(cwd, options.fromSemgrep);
    if (!fs.existsSync(semgrepPath)) {
      log.error('Totem Error', `Semgrep rules file not found: ${semgrepPath}`);
      process.exitCode = 1;
      return;
    }

    const content = fs.readFileSync(semgrepPath, 'utf-8');
    const { parseSemgrepRules } = await import('@mmnto/totem');
    const result = parseSemgrepRules(content);

    importedRules.push(...result.rules);
    for (const s of result.skipped) {
      allSkipped.push({ id: s.id, reason: s.reason });
    }
  }

  // 3. Process ESLint config
  if (options.fromEslint) {
    const eslintPath = path.resolve(cwd, options.fromEslint);
    if (!fs.existsSync(eslintPath)) {
      log.error('Totem Error', `ESLint config file not found: ${eslintPath}`);
      process.exitCode = 1;
      return;
    }

    const content = fs.readFileSync(eslintPath, 'utf-8');
    const { parseEslintConfig } = await import('@mmnto/totem');
    const result = parseEslintConfig(content);

    importedRules.push(...result.rules);
    for (const s of result.skipped) {
      allSkipped.push({ id: s.rule, reason: s.reason });
    }
  }

  // 4. Log skipped rules
  if (allSkipped.length > 0) {
    log.warn(TAG, `${allSkipped.length} rule(s) skipped:`);
    for (const s of allSkipped) {
      log.dim(TAG, `  ${s.id}: ${s.reason}`);
    }
  }

  if (importedRules.length === 0) {
    log.warn(TAG, 'No rules could be imported from the provided config(s).');
    return;
  }

  // 5. Dry-run: preview without writing
  if (options.dryRun) {
    log.info(TAG, `${bold('Dry run')} — ${importedRules.length} rule(s) would be imported:`);
    for (const rule of importedRules) {
      log.info(TAG, `  ${rule.lessonHash.slice(0, 8)} ${rule.lessonHeading}`);
    }
    return;
  }

  // 6. Load existing compiled-rules.json
  const existing = loadCompiledRulesFile(rulesPath);

  // 7. Merge: deduplicate by lessonHash (imported rules replace existing with same hash)
  const merged = new Map<string, CompiledRule>();
  for (const rule of existing.rules) {
    merged.set(rule.lessonHash, rule);
  }
  for (const rule of importedRules) {
    merged.set(rule.lessonHash, rule);
  }

  // 8. Write updated compiled-rules.json
  fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
  saveCompiledRulesFile(rulesPath, {
    version: 1,
    rules: [...merged.values()],
    nonCompilable: existing.nonCompilable,
  });

  // 9. Log summary
  log.success(
    TAG,
    `${bold(String(importedRules.length))} imported, ${bold(String(allSkipped.length))} skipped, ${bold(String(merged.size))} total rules`,
  );
}
