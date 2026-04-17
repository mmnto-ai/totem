/**
 * `totem install pack/<name>` — pack install command (mmnto-ai/totem#1491).
 *
 * Executes the ADR-085 pack install flow:
 *   1. Validate the target syntax (`pack/name` or `pack/@scope/name`).
 *   2. Short-circuit if the pack is already in the `extends` array.
 *   3. Fetch the pack via the repo's existing package manager (pm-detection
 *      mirrors `totem init`).
 *   4. Validate the pack manifest structure before mutating any repo state
 *      outside `node_modules`. This ordering matters: if validation fails
 *      we have not yet touched `totem.config.ts` or the local rules file,
 *      so the user's repo stays in a clean state.
 *   5. Update the `extends` array in `totem.config.ts`.
 *   6. Merge pack rules into `.totem/compiled-rules.json` via the
 *      mmnto-ai/totem#1515 `mergeRules` primitive.
 *   7. Merge `.totemignore` entries. Without `--yes` the command prints a
 *      diff preview and skips the merge with a reminder; with `--yes` it
 *      appends the missing entries.
 *
 * All errors thread the underlying cause through `TotemConfigError` so the
 * central error handler can present the full chain.
 */

import type { CompiledRule, CompiledRulesFile } from '@mmnto/totem';

// ─── Pure helpers (exported for unit tests) ─────────

export function detectPackageManager(
  fs: { existsSync: (p: string) => boolean },
  path: { join: (...paths: string[]) => string },
  cwd: string,
): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  // totem-context: bun lockfile names are intentional package-manager probes
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) {
    return 'bun';
  }
  return 'npm';
}

/**
 * Resolve the npm package name from a `pack/<name>` or `pack/@scope/<name>` target.
 * Accepts raw npm names unchanged so callers that have already normalized
 * do not double-strip the prefix.
 */
export function resolvePackName(target: string): string {
  if (target.startsWith('pack/')) return target.slice(5);
  return target;
}

export function isValidTarget(target: string): boolean {
  return /^pack\/(@[a-z0-9-]+\/)?[a-z0-9-]+$/i.test(target);
}

/**
 * Check whether the pack is already referenced inside the `extends` array.
 * Scoped to the array contents so that a comment or unrelated property
 * containing the same string does not short-circuit the install.
 */
export function isInExtends(configContent: string, packName: string): boolean {
  const match = configContent.match(/extends\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return false;
  const body = match[1] ?? '';
  return (
    body.includes(`'${packName}'`) ||
    body.includes(`"${packName}"`) ||
    body.includes(`\`${packName}\``)
  );
}

/**
 * Build the `.totemignore` diff shown to the user when `--yes` is not
 * provided. Returns only the lines that would be appended.
 */
export function buildTotemignoreDiff(
  packIgnoreContent: string,
  localIgnoreContent: string,
): string[] {
  const localLines = new Set(
    localIgnoreContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  return packIgnoreContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !localLines.has(l));
}

// ─── Install options ────────────────────────────────

export interface InstallOptions {
  /**
   * Skip the interactive diff preview for the `.totemignore` merge and
   * append missing entries directly. Required in non-interactive contexts
   * (CI) per the #1491 AC.
   */
  yes?: boolean;
}

// ─── Command ────────────────────────────────────────

export async function installCommand(target: string, options: InstallOptions = {}): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { safeExec, mergeRules, CompiledRulesFileSchema, TotemConfigError } =
    await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { resolveConfigPath } = await import('../utils.js');
  const { resolveGitRoot } = await import('../git.js');

  const TAG = 'Install';
  const cwd = process.cwd();
  const gitRoot = resolveGitRoot(cwd) || cwd;
  const totemDir = path.join(gitRoot, '.totem');

  // ── 1. Validate target syntax ─────────────────
  if (!isValidTarget(target)) {
    throw new TotemConfigError(
      `Invalid target: ${target}. Expected format: pack/<name> or pack/@scope/<name>`,
      'Example: totem install pack/agent-security',
      'CONFIG_INVALID',
    );
  }

  const packName = resolvePackName(target);
  const configPath = resolveConfigPath(gitRoot);
  const configContent =
    configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';

  // ── 2. Short-circuit if already installed ─────
  if (configContent && isInExtends(configContent, packName)) {
    log.dim(TAG, `Pack ${packName} is already in extends; nothing to do.`);
    return;
  }

  // ── 3. Fetch via package manager ──────────────
  const pm = detectPackageManager(fs, path, gitRoot);
  log.info(TAG, `Fetching ${packName} via ${pm}...`);
  try {
    const args = pm === 'npm' ? ['install', '-D', packName] : ['add', '-D', packName];
    safeExec(pm, args, { cwd: gitRoot });
  } catch (err) {
    throw new TotemConfigError(
      `Failed to fetch pack ${packName} via ${pm}.`,
      'Check the package name and your registry access.',
      'CONFIG_INVALID',
      err,
    );
  }

  // ── 4. Validate pack manifest BEFORE touching repo state ──
  const packDir = path.join(gitRoot, 'node_modules', packName);
  const packPkgPath = path.join(packDir, 'package.json');
  if (!fs.existsSync(packPkgPath)) {
    throw new TotemConfigError(
      `Pack ${packName} installed but package.json is missing at ${packPkgPath}.`,
      'The installed package does not look like a Totem pack.',
      'CONFIG_INVALID',
    );
  }

  let packPkg: { exports?: Record<string, unknown> };
  try {
    packPkg = JSON.parse(fs.readFileSync(packPkgPath, 'utf-8')) as {
      exports?: Record<string, unknown>;
    };
  } catch (err) {
    throw new TotemConfigError(
      `Pack ${packName} has an unparseable package.json.`,
      'The installed package is corrupt or was not written correctly.',
      'CONFIG_INVALID',
      err,
    );
  }

  if (!packPkg.exports || !packPkg.exports['./compiled-rules.json']) {
    throw new TotemConfigError(
      `Package ${packName} is not a Totem pack (missing exports['./compiled-rules.json']).`,
      'Totem packs declare their compiled rules file under the package exports map.',
      'CONFIG_INVALID',
    );
  }

  const packRulesPath = path.join(packDir, 'compiled-rules.json');
  if (!fs.existsSync(packRulesPath)) {
    throw new TotemConfigError(
      `Pack ${packName} declares a rules export but compiled-rules.json is missing at ${packRulesPath}.`,
      'The pack may have shipped an empty or broken build.',
      'CONFIG_INVALID',
    );
  }

  let packRulesFile: CompiledRulesFile;
  try {
    const raw = JSON.parse(fs.readFileSync(packRulesPath, 'utf-8')) as unknown;
    packRulesFile = CompiledRulesFileSchema.parse(raw);
  } catch (err) {
    throw new TotemConfigError(
      `Pack ${packName} has a malformed compiled-rules.json.`,
      'The file must match the CompiledRulesFile schema.',
      'CONFIG_INVALID',
      err,
    );
  }

  // ── 5. Update extends in totem.config.ts ──────
  if (configPath && configContent) {
    const updatedConfig = addToExtends(configContent, packName);
    if (updatedConfig === null) {
      throw new TotemConfigError(
        `Could not update extends array in ${configPath}.`,
        'The config file did not match the expected shape; add the pack manually.',
        'CONFIG_INVALID',
      );
    }
    fs.writeFileSync(configPath, updatedConfig, 'utf-8');
    log.success(TAG, `Added ${packName} to extends in ${path.basename(configPath)}.`);
  } else {
    log.warn(
      TAG,
      `No totem.config.ts found. Add ${JSON.stringify(packName)} to your extends array manually.`,
    );
  }

  // ── 6. Merge rules into .totem/compiled-rules.json ──
  mergeLocalRules(fs, totemDir, path.join(totemDir, 'compiled-rules.json'), packRulesFile, {
    mergeRules,
    CompiledRulesFileSchema,
    TotemConfigError,
    log,
    tag: TAG,
    packName,
  });

  // ── 7. Merge .totemignore entries ─────────────
  const packIgnorePath = path.join(packDir, '.totemignore');
  if (fs.existsSync(packIgnorePath)) {
    mergeTotemIgnore(
      fs,
      path.join(gitRoot, '.totemignore'),
      fs.readFileSync(packIgnorePath, 'utf-8'),
      packName,
      options.yes === true,
      log,
      TAG,
    );
  }

  log.success(TAG, `Installed ${packName}.`);
}

// ─── Internal helpers (not exported) ────────────────

/**
 * Add `packName` to the `extends` array in a totem.config.ts file.
 * Returns the updated content, or null if the config shape was not
 * recognized. Uses replacer functions (never string back-references) so
 * dynamic content cannot trigger `$&` / `$1` interpretation.
 */
function addToExtends(configContent: string, packName: string): string | null {
  const existingExtends = /extends\s*:\s*\[/;
  if (existingExtends.test(configContent)) {
    return configContent.replace(
      existingExtends,
      () => `extends: [\n    ${JSON.stringify(packName)},`,
    );
  }
  const exportDefault = /export\s+default\s+\{/;
  if (exportDefault.test(configContent)) {
    return configContent.replace(
      exportDefault,
      () => `export default {\n  extends: [${JSON.stringify(packName)}],`,
    );
  }
  return null;
}

interface MergeLocalRulesDeps {
  mergeRules: (
    localRules: readonly CompiledRule[],
    packRules: readonly CompiledRule[],
  ) => { rules: CompiledRule[] };
  CompiledRulesFileSchema: { parse: (input: unknown) => CompiledRulesFile };
  TotemConfigError: new (
    message: string,
    hint: string,
    code: 'CONFIG_INVALID' | 'CONFIG_MISSING',
    cause?: unknown,
  ) => Error;
  log: { success: (tag: string, msg: string) => void; dim: (tag: string, msg: string) => void };
  tag: string;
  packName: string;
}

/**
 * Merge pack rules into the local compiled-rules.json. Parses and validates
 * the local file before mutating anything; on parse failure throws rather
 * than silently overwriting. Mirrors the #1515 `mergeRules` contract.
 */
function mergeLocalRules(
  fs: typeof import('node:fs'),
  totemDir: string,
  localRulesPath: string,
  packRulesFile: CompiledRulesFile,
  deps: MergeLocalRulesDeps,
): void {
  const empty: CompiledRulesFile = { version: 1, rules: [], nonCompilable: [] };

  let localRulesFile: CompiledRulesFile;
  if (fs.existsSync(localRulesPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(localRulesPath, 'utf-8')) as unknown;
      localRulesFile = deps.CompiledRulesFileSchema.parse(raw);
    } catch (err) {
      // Refuse to proceed: silently overwriting a broken local rules file
      // would destroy the user's data. Abort so they can recover the file
      // or regenerate it via `totem lesson compile`.
      throw new deps.TotemConfigError(
        `Local ${localRulesPath} could not be parsed; refusing to merge pack rules.`,
        'Fix the file manually or delete it and run `totem lesson compile` to regenerate.',
        'CONFIG_INVALID',
        err,
      );
    }
  } else {
    localRulesFile = empty;
    if (!fs.existsSync(totemDir)) {
      fs.mkdirSync(totemDir, { recursive: true });
    }
  }

  const { rules: mergedRules } = deps.mergeRules(localRulesFile.rules, packRulesFile.rules);
  const output: CompiledRulesFile = { ...localRulesFile, rules: mergedRules };
  fs.writeFileSync(localRulesPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  deps.log.success(
    deps.tag,
    `Merged ${packRulesFile.rules.length} rule(s) from ${deps.packName}; ` +
      `local now has ${mergedRules.length} rule(s).`,
  );
}

/**
 * Merge entries from the pack's `.totemignore` into the repo's own. Without
 * `--yes` the function prints the proposed additions as a diff and skips
 * the append so CI does not silently mutate repo state. With `--yes` the
 * additions are appended with a header comment naming the pack.
 */
function mergeTotemIgnore(
  fs: typeof import('node:fs'),
  localIgnorePath: string,
  packIgnoreContent: string,
  packName: string,
  autoApprove: boolean,
  log: {
    success: (tag: string, msg: string) => void;
    info: (tag: string, msg: string) => void;
    dim: (tag: string, msg: string) => void;
  },
  tag: string,
): void {
  const localIgnoreContent = fs.existsSync(localIgnorePath)
    ? fs.readFileSync(localIgnorePath, 'utf-8')
    : '';
  const additions = buildTotemignoreDiff(packIgnoreContent, localIgnoreContent);

  if (additions.length === 0) {
    log.dim(tag, `.totemignore merge: no new entries from ${packName}.`);
    return;
  }

  if (!autoApprove) {
    log.info(tag, `.totemignore diff from ${packName} (${additions.length} new entries):`);
    for (const line of additions) {
      log.dim(tag, `  + ${line}`);
    }
    log.info(tag, `Re-run with --yes to apply, or copy the entries into .totemignore manually.`);
    return;
  }

  const separator = localIgnoreContent && !localIgnoreContent.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(
    localIgnorePath,
    `${separator}# Merged from ${packName}\n${additions.join('\n')}\n`,
  );
  log.success(tag, `.totemignore: appended ${additions.length} entries from ${packName}.`);
}
