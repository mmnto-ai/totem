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

/**
 * Gate on the `pack/<name>` or `pack/@scope/<name>` shape. Rejects leading
 * hyphens in the name segment (a flag-injection hardening pair with the
 * `--` delimiter on the install invocation below). Rejects targets longer
 * than 214 chars per the npm package-name spec.
 */
export function isValidTarget(target: string): boolean {
  if (target.length > 214) return false;
  return /^pack\/(@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/i.test(target);
}

/**
 * Strip line comments, block comments, AND string literal contents from a
 * JS/TS source string. Replaces scrubbed characters with spaces so
 * character offsets are preserved for downstream regex matches.
 *
 * String-literal handling is required (GCA finding on PR mmnto-ai/totem#1516): a rule
 * message or regex pattern in a string literal might contain `//`, `/*`,
 * or the structural sequence `extends: [`. Without tracking string
 * boundaries the matcher would either trip on a commented-out-looking
 * prefix inside a string, or (worse) inject new syntax into the middle
 * of a string when `addToExtends` rewrites by offset.
 */
function stripComments(source: string): string {
  let result = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Line comment: replace with spaces through the next newline.
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }

    // Block comment: replace with spaces through the closing */.
    if (ch === '/' && next === '*') {
      result += '  ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) {
        result += '  ';
        i += 2;
      }
      continue;
    }

    // String literal: scrub contents while preserving newlines and the
    // opening/closing quote characters (so the downstream regex cannot
    // mistake them for structural syntax). Single-quote, double-quote,
    // and backtick strings are all tracked. Escape sequences are
    // handled by skipping the character after a backslash.
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      result += ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          result += '  ';
          i += 2;
          continue;
        }
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < source.length) {
        result += source[i];
        i++;
      }
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

/**
 * Resolve the actual filesystem subpath declared under a package's
 * `exports['./compiled-rules.json']` entry. Accepts:
 *   - `"./compiled-rules.json"` (plain string)
 *   - `{ default: "./dist/compiled-rules.json" }` (single-condition object)
 *   - `{ import: "./dist/foo.json", require: "./dist/foo.json" }` (first
 *     string value wins; packs should not need multiple conditions for
 *     a JSON payload but we accept it without choking)
 *
 * Returns null when the export value cannot be resolved to a usable
 * subpath, so the caller can produce a targeted error. Shield finding
 * on PR mmnto-ai/totem#1516: hardcoding `compiled-rules.json` bypassed the exports
 * contract and would mis-read packs that publish to a subdirectory.
 */
export function resolveCompiledRulesExport(exportValue: unknown): string | null {
  if (typeof exportValue === 'string') return exportValue;
  // Order matters: the null guard trails the object-type check so short-
  // circuit evaluation protects the property access below. The runtime
  // behavior matches a leading truthy guard (object-type check returns
  // true for null, then the trailing conjunction short-circuits).
  if (typeof exportValue === 'object' && exportValue) {
    const conditions = exportValue as Record<string, unknown>;
    if (typeof conditions['default'] === 'string') return conditions['default'];
    for (const v of Object.values(conditions)) {
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

/**
 * Check whether the pack is already referenced inside the `extends` array.
 * Scoped to the array contents so that a comment or unrelated property
 * containing the same string does not short-circuit the install.
 *
 * Uses `stripComments` to locate the extends array range (so a
 * commented-out `// extends: [...]` line or string-literal content is
 * not mistaken for the active declaration), then searches the ORIGINAL
 * content at those offsets for the pack name — the stripped version
 * has scrubbed string contents and would miss real array entries.
 */
export function isInExtends(configContent: string, packName: string): boolean {
  const stripped = stripComments(configContent);
  const match = stripped.match(/extends\s*:\s*\[([\s\S]*?)\]/);
  if (!match || match.index === undefined) return false;
  const bodyStart = match.index + match[0].indexOf('[') + 1;
  const bodyEnd = bodyStart + (match[1] ?? '').length;
  const body = configContent.slice(bodyStart, bodyEnd);
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
   * (CI) per the mmnto-ai/totem#1491 AC.
   */
  yes?: boolean;
}

// ─── Command ────────────────────────────────────────

export async function installCommand(target: string, options: InstallOptions = {}): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { safeExec, mergeRules, CompiledRulesFileSchema, saveCompiledRulesFile, TotemConfigError } =
    await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { isGlobalConfigPath, resolveConfigPath } = await import('../utils.js');
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

  // Config path is optional for install — the command can still merge
  // rules and the ignore file when no config exists, leaving only an
  // extends-array warning. resolveConfigPath throws CONFIG_MISSING when
  // no config is found; catch that one code and proceed without one.
  // Reject global-config resolution: totem install targets the current
  // project, never the user's personal profile.
  let configPath: string | undefined;
  try {
    const resolved = resolveConfigPath(gitRoot);
    if (isGlobalConfigPath(resolved)) {
      log.warn(TAG, `Skipping ${resolved}: totem install only modifies a project-local config.`);
    } else {
      configPath = resolved;
    }
  } catch (err) {
    if (!(err instanceof TotemConfigError && err.code === 'CONFIG_MISSING')) {
      throw err;
    }
  }

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
    // The `--` delimiter hardens against flag injection: a pack name
    // starting with `-` would otherwise be parsed as a package-manager
    // flag. `isValidTarget` already rejects leading hyphens; the
    // delimiter is belt-and-suspenders.
    const args = pm === 'npm' ? ['install', '-D', '--', packName] : ['add', '-D', '--', packName];
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

  // Resolve the actual file path from the exports map. Packs that ship
  // their build to a subdirectory (e.g. `./dist/compiled-rules.json`)
  // must not be read from `packDir/compiled-rules.json`.
  const exportValue = packPkg.exports['./compiled-rules.json'];
  const exportSubpath = resolveCompiledRulesExport(exportValue);
  if (!exportSubpath) {
    throw new TotemConfigError(
      `Pack ${packName} exports['./compiled-rules.json'] is not a resolvable subpath.`,
      'The export must be a string, or an object whose default/first string value is a path.',
      'CONFIG_INVALID',
    );
  }
  const packRulesPath = path.join(packDir, exportSubpath);
  if (!fs.existsSync(packRulesPath)) {
    throw new TotemConfigError(
      `Pack ${packName} declares a rules export at ${exportSubpath} but the file is missing (${packRulesPath}).`,
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
  // Failure to update the config is a soft failure: log a warning with
  // manual-edit guidance and continue with the rules/ignore merge.
  // Throwing here would brick the install (Shield finding on PR mmnto-ai/totem#1516):
  // the user adds the pack manually to extends, re-runs totem install,
  // isInExtends short-circuits, and the rules/ignore merge is skipped
  // forever. Proceeding with a warning keeps the install recoverable.
  if (configPath && configContent) {
    const updatedConfig = addToExtends(configContent, packName);
    if (updatedConfig === null) {
      log.warn(
        TAG,
        `Could not auto-update extends array in ${configPath}. Add ${JSON.stringify(packName)} to it manually; continuing with rules merge.`,
      );
    } else {
      fs.writeFileSync(configPath, updatedConfig, 'utf-8');
      log.success(TAG, `Added ${packName} to extends in ${path.basename(configPath)}.`);
    }
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
    saveCompiledRulesFile,
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
 *
 * Search uses `stripComments` so a commented-out `// extends: [...]` is
 * not treated as the active declaration. The edit applies to the same
 * offset in the original content because `stripComments` preserves
 * character positions.
 */
function addToExtends(configContent: string, packName: string): string | null {
  const stripped = stripComments(configContent);

  const extendsMatch = stripped.match(/extends\s*:\s*\[/);
  if (extendsMatch && extendsMatch.index !== undefined) {
    const start = extendsMatch.index;
    const end = start + extendsMatch[0].length;
    return (
      configContent.slice(0, start) +
      `extends: [\n    ${JSON.stringify(packName)},` +
      configContent.slice(end)
    );
  }

  const exportMatch = stripped.match(/export\s+default\s+\{/);
  if (exportMatch && exportMatch.index !== undefined) {
    const start = exportMatch.index;
    const end = start + exportMatch[0].length;
    return (
      configContent.slice(0, start) +
      `export default {\n  extends: [${JSON.stringify(packName)}],` +
      configContent.slice(end)
    );
  }

  return null;
}

interface MergeBlock {
  lessonHash: string;
  lessonHeading: string;
  attemptedChange: 'severity-downgrade' | 'archive' | 'both';
}

interface MergeLocalRulesDeps {
  mergeRules: (
    localRules: readonly CompiledRule[],
    packRules: readonly CompiledRule[],
  ) => { rules: CompiledRule[]; blocks: MergeBlock[] };
  CompiledRulesFileSchema: { parse: (input: unknown) => CompiledRulesFile };
  /**
   * Strict writer so the pack-merge path runs every `nonCompilable` entry
   * through `NonCompilableEntryWriteSchema` (mmnto-ai/totem#1481). Using
   * this instead of a raw `fs.writeFileSync` keeps install.ts honest
   * against the Read/Write schema invariant — a pack shipping a legacy
   * 2-tuple would otherwise be silently legitimized on disk.
   */
  saveCompiledRulesFile: (rulesPath: string, data: CompiledRulesFile) => void;
  TotemConfigError: new (
    message: string,
    hint: string,
    code: 'CONFIG_INVALID' | 'CONFIG_MISSING',
    cause?: unknown,
  ) => Error;
  log: {
    success: (tag: string, msg: string) => void;
    dim: (tag: string, msg: string) => void;
    warn: (tag: string, msg: string) => void;
  };
  tag: string;
  packName: string;
}

/**
 * Merge pack rules into the local compiled-rules.json. Parses and validates
 * the local file before mutating anything; on parse failure throws rather
 * than silently overwriting. Mirrors the mmnto-ai/totem#1515 `mergeRules` contract.
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

  const { rules: mergedRules, blocks } = deps.mergeRules(localRulesFile.rules, packRulesFile.rules);

  // Surface ADR-089 immutable override blocks as warnings so the user
  // knows their local severity/archive changes were ignored and why.
  for (const block of blocks) {
    deps.log.warn(
      deps.tag,
      `Immutable rule override blocked: "${block.lessonHeading}" (${block.lessonHash}) — ` +
        `local ${block.attemptedChange} ignored; pack enforcement wins per ADR-089.`,
    );
  }

  // Merge the pack's nonCompilable entries into the local set. These
  // are conceptual/architectural lessons the pack shipped as metadata;
  // dropping them on install would lose their reachability for
  // `search_knowledge` and downstream reporting (GCA finding on mmnto-ai/totem#1516).
  const localNonCompilable = localRulesFile.nonCompilable ?? [];
  const packNonCompilable = packRulesFile.nonCompilable ?? [];
  const seenHashes = new Set(localNonCompilable.map((e) => e.hash));
  const mergedNonCompilable = [...localNonCompilable];
  for (const entry of packNonCompilable) {
    if (!seenHashes.has(entry.hash)) {
      mergedNonCompilable.push(entry);
      seenHashes.add(entry.hash);
    }
  }

  const output: CompiledRulesFile = {
    ...localRulesFile,
    rules: mergedRules,
    nonCompilable: mergedNonCompilable,
  };
  deps.saveCompiledRulesFile(localRulesPath, output);
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
