import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type CompiledRulesFile,
  CompiledRulesFileSchema,
  mergeRules,
  safeExec,
} from '@mmnto/totem';

import { resolveGitRoot } from '../git.js';
import { log } from '../ui.js';
import { resolveConfigPath } from '../utils.js';

export function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bun';
  return 'npm';
}

export function resolvePackName(target: string): string {
  if (target.startsWith('pack/')) {
    return target.slice(5);
  }
  return target;
}

export async function installCommand(target: string): Promise<void> {
  const cwd = process.cwd();
  const gitRoot = resolveGitRoot(cwd) || cwd;
  const totemDir = path.join(gitRoot, '.totem');

  if (!target.startsWith('pack/') && !target.startsWith('@') && !target.match(/^[a-z0-9-]/i)) {
    log.error(
      'Totem',
      `Invalid target: ${target}. Expected format: pack/<name> or pack/@scope/<name>`,
    );
    process.exit(1);
  }

  const packName = resolvePackName(target);

  // 1. Resolver & extends merge config idempotency
  const configPath = resolveConfigPath(gitRoot);
  let configExists = false;
  let configContent = '';

  if (configPath && fs.existsSync(configPath)) {
    configExists = true;
    configContent = fs.readFileSync(configPath, 'utf-8');

    // Simplistic check for idempotency (checks if packName is already in extends)
    if (
      configContent.includes(`'${packName}'`) ||
      configContent.includes(`"${packName}"`) ||
      configContent.includes(`\`${packName}\``)
    ) {
      log.dim('Totem', `Pack ${packName} is already installed in extends array.`);
      process.exit(0);
    }
  }

  // 2. Fetcher
  const pm = detectPackageManager(gitRoot);
  log.info('Totem', `Fetching ${packName} via ${pm}...`);
  try {
    const args = pm === 'npm' ? ['install', '-D', packName] : ['add', '-D', packName];
    safeExec(pm, args, { cwd: gitRoot });
  } catch (err) {
    log.error('Totem', `Failed to fetch pack ${packName}.`);
    if (err instanceof Error) log.dim('Totem', err.message);
    process.exit(1);
  }

  // 3. Extends config merge
  if (configPath && fs.existsSync(configPath)) {
    let updatedConfig = configContent;
    const extendsMatch = updatedConfig.match(/extends:\s*\[/);
    if (extendsMatch) {
      updatedConfig = updatedConfig.replace(/extends:\s*\[/, `extends: [\n    '${packName}',`);
      fs.writeFileSync(configPath, updatedConfig, 'utf-8');
      log.success('Totem', `Added ${packName} to extends array in totem.config.ts`);
    } else {
      const exportMatch = updatedConfig.match(/export\s+default\s+\{/);
      if (exportMatch) {
        updatedConfig = updatedConfig.replace(
          /export\s+default\s+\{/,
          `export default {\n  extends: [\n    '${packName}',\n  ],`,
        );
        fs.writeFileSync(configPath, updatedConfig, 'utf-8');
        log.success('Totem', `Added extends array with ${packName} to totem.config.ts`);
      } else {
        log.error(
          'Totem',
          `Could not automatically update totem.config.ts to add extends array. Please add it manually.`,
        );
        process.exit(1); // Exit non-zero on partial failure
      }
    }
  } else {
    // If there is no config file, warn but do not crash
    log.dim(
      'Totem',
      `No totem.config.ts found. You must manually add '${packName}' to your extends array.`,
    );
  }

  // 4. Validate Pack Manifest and load rules
  let packDir = path.join(gitRoot, 'node_modules', packName);
  if (!fs.existsSync(packDir)) {
    packDir = path.join(gitRoot, 'node_modules', packName.split('/').join(path.sep));
  }

  const packPkgPath = path.join(packDir, 'package.json');
  if (!fs.existsSync(packPkgPath)) {
    log.error('Totem', `Malformed pack manifest: missing package.json in ${packName}`);
    process.exit(1);
  }

  let packPkg;
  try {
    packPkg = JSON.parse(fs.readFileSync(packPkgPath, 'utf-8'));
  } catch {
    log.error('Totem', `Malformed pack manifest: invalid package.json in ${packName}`);
    process.exit(1);
  }

  // Check for pack marker - usually exports['./compiled-rules.json']
  const isPack = packPkg.exports && packPkg.exports['./compiled-rules.json'];
  if (!isPack) {
    log.error(
      'Totem',
      `Malformed pack manifest: missing pack marker (exports['./compiled-rules.json']) in ${packName}`,
    );
    process.exit(1);
  }

  // Load pack rules
  const packRulesPath = path.join(packDir, 'compiled-rules.json');
  if (!fs.existsSync(packRulesPath)) {
    log.error('Totem', `Malformed pack manifest: no compiled-rules.json found in ${packName}`);
    process.exit(1);
  }

  let packRulesFile: CompiledRulesFile;
  try {
    packRulesFile = JSON.parse(fs.readFileSync(packRulesPath, 'utf-8'));
    CompiledRulesFileSchema.parse(packRulesFile);
  } catch (err) {
    log.error('Totem', `Malformed pack manifest: compiled-rules.json is invalid in ${packName}`);
    if (err instanceof Error) log.dim('Totem', err.message);
    process.exit(1);
  }

  // 5. Merge Rules into .totem/compiled-rules.json
  const localRulesPath = path.join(totemDir, 'compiled-rules.json');
  let localRulesFile: CompiledRulesFile = { version: 1, rules: [], nonCompilable: [] };
  if (fs.existsSync(localRulesPath)) {
    try {
      const content = fs.readFileSync(localRulesPath, 'utf-8');
      localRulesFile = JSON.parse(content);
    } catch {
      log.error('Totem', `Local compiled-rules.json is invalid. Skipping rules merge.`);
    }
  }

  const { rules: mergedRules } = mergeRules(localRulesFile.rules, packRulesFile.rules);
  localRulesFile.rules = mergedRules;

  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }
  fs.writeFileSync(localRulesPath, JSON.stringify(localRulesFile, null, 2) + '\n', 'utf-8');

  // 6. Merge .totemignore if present
  const packIgnorePath = path.join(packDir, '.totemignore');
  if (fs.existsSync(packIgnorePath)) {
    const packIgnoreContent = fs.readFileSync(packIgnorePath, 'utf-8').trim();
    if (packIgnoreContent) {
      const localIgnorePath = path.join(gitRoot, '.totemignore');
      let localIgnoreContent = '';
      if (fs.existsSync(localIgnorePath)) {
        localIgnoreContent = fs.readFileSync(localIgnorePath, 'utf-8');
      }

      const newLines = packIgnoreContent
        .split('\n')
        .filter((l) => l.trim() && !localIgnoreContent.includes(l.trim()));
      if (newLines.length > 0) {
        const separator = localIgnoreContent && !localIgnoreContent.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(
          localIgnorePath,
          `${separator}# Merged from ${packName}\n${newLines.join('\n')}\n`,
        );
        log.success('Totem', `Merged .totemignore from ${packName}`);
      }
    }
  }

  log.success('Totem', `Successfully installed ${packName}`);
}
