export function detectPackageManager(
  fs: { existsSync: (p: string) => boolean },
  path: { join: (...paths: string[]) => string },
  cwd: string,
): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  // totem-context: bun lockfile names are intentional package-manager probes
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
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { safeExec, mergeRules, CompiledRulesFileSchema, TotemConfigError } =
    await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { resolveConfigPath } = await import('../utils.js');
  const { resolveGitRoot } = await import('../git.js');

  const cwd = process.cwd();
  const gitRoot = resolveGitRoot(cwd) || cwd;
  const totemDir = path.join(gitRoot, '.totem');

  if (!/^pack\/(@[a-z0-9-]+\/)?[a-z0-9-]+$/i.test(target)) {
    throw new TotemConfigError(
      `Invalid target: ${target}. Expected format: pack/<name> or pack/@scope/<name>`,
      '',
      'CONFIG_INVALID',
    );
  }

  const packName = resolvePackName(target);

  const configPath = resolveConfigPath(gitRoot);
  let configContent = '';

  if (configPath && fs.existsSync(configPath)) {
    configContent = fs.readFileSync(configPath, 'utf-8');

    const extendsMatch = configContent.match(/extends:\s*\[([^\]]*)\]/);
    if (extendsMatch) {
      const extendsArray = extendsMatch[1];
      if (
        extendsArray.indexOf(`'${packName}'`) !== -1 ||
        extendsArray.indexOf(`"${packName}"`) !== -1 ||
        extendsArray.indexOf(`\`${packName}\``) !== -1
      ) {
        log.dim('Totem', `Pack ${packName} is already installed in extends array.`);
        return;
      }
    }
  }

  const pm = detectPackageManager(fs, path, gitRoot);
  log.info('Totem', `Fetching ${packName} via ${pm}...`);
  try {
    const args = pm === 'npm' ? ['install', '-D', packName] : ['add', '-D', packName];
    safeExec(pm, args, { cwd: gitRoot });
  } catch (err) {
    throw new TotemConfigError(`Failed to fetch pack ${packName}.`, '', 'CONFIG_INVALID', err);
  }

  if (configPath && fs.existsSync(configPath)) {
    let updatedConfig = configContent;
    const extendsMatch = updatedConfig.match(/extends:\s*\[/);
    if (extendsMatch) {
      updatedConfig = updatedConfig.replace(
        /extends:\s*\[/,
        () => `extends: [\n    '${packName}',`,
      );
      fs.writeFileSync(configPath, updatedConfig, 'utf-8');
      log.success('Totem', `Added ${packName} to extends array in totem.config.ts`);
    } else {
      const exportMatch = updatedConfig.match(/export\s+default\s+\{/);
      if (exportMatch) {
        updatedConfig = updatedConfig.replace(
          /export\s+default\s+\{/,
          () => `export default {\n  extends: [\n    '${packName}',\n  ],`,
        );
        fs.writeFileSync(configPath, updatedConfig, 'utf-8');
        log.success('Totem', `Added extends array with ${packName} to totem.config.ts`);
      } else {
        throw new TotemConfigError(
          `Could not automatically update totem.config.ts to add extends array. Please add it manually.`,
          '',
          'CONFIG_INVALID',
        );
      }
    }
  } else {
    log.dim(
      'Totem',
      `No totem.config.ts found. You must manually add '${packName}' to your extends array.`,
    );
  }

  const packDir = path.join(gitRoot, 'node_modules', packName);

  const packPkgPath = path.join(packDir, 'package.json');
  if (!fs.existsSync(packPkgPath)) {
    throw new TotemConfigError(
      `Malformed pack manifest: missing package.json in ${packName}`,
      '',
      'CONFIG_INVALID',
    );
  }

  let packPkg;
  try {
    packPkg = JSON.parse(fs.readFileSync(packPkgPath, 'utf-8'));
  } catch {
    throw new TotemConfigError(
      `Malformed pack manifest: unparseable package.json in ${packName}`,
      '',
      'CONFIG_INVALID',
    );
  }

  const isPack = packPkg.exports && packPkg.exports['./compiled-rules.json'];
  if (!isPack) {
    throw new TotemConfigError(
      `Malformed pack manifest: missing pack marker (exports['./compiled-rules.json']) in ${packName}`,
      '',
      'CONFIG_INVALID',
    );
  }

  const packRulesPath = path.join(packDir, 'compiled-rules.json');
  if (!fs.existsSync(packRulesPath)) {
    throw new TotemConfigError(
      `Malformed pack manifest: no compiled-rules.json found in ${packName}`,
      '',
      'CONFIG_INVALID',
    );
  }

  let packRulesFile: import('@mmnto/totem').CompiledRulesFile | undefined;
  try {
    packRulesFile = JSON.parse(fs.readFileSync(packRulesPath, 'utf-8'));
    CompiledRulesFileSchema.parse(packRulesFile);
  } catch {
    throw new TotemConfigError(
      `Malformed pack manifest: compiled-rules.json is malformed in ${packName}`,
      '',
      'CONFIG_INVALID',
    );
  }

  const localRulesPath = path.join(totemDir, 'compiled-rules.json');
  let localRulesFile: Record<string, unknown> = { version: 1, rules: [], nonCompilable: [] };
  if (fs.existsSync(localRulesPath)) {
    try {
      const content = fs.readFileSync(localRulesPath, 'utf-8');
      localRulesFile = JSON.parse(content);
      // totem-context: intentional cleanup
    } catch (_err) {
      log.error('Totem Error', `Local compiled-rules.json is unparseable. Skipping rules merge.`);
    }
  }
  const localRulesArray = Array.isArray(localRulesFile.rules) ? localRulesFile.rules : [];
  const packRulesArray = packRulesFile ? packRulesFile.rules : [];

  const { rules: mergedRules } = mergeRules(
    localRulesArray as import('@mmnto/totem').CompiledRule[],
    packRulesArray,
  );
  localRulesFile.rules = mergedRules;

  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }
  fs.writeFileSync(localRulesPath, JSON.stringify(localRulesFile, null, 2) + '\n', 'utf-8');

  const packIgnorePath = path.join(packDir, '.totemignore');
  if (fs.existsSync(packIgnorePath)) {
    const packIgnoreContent = fs.readFileSync(packIgnorePath, 'utf-8').trim();
    if (packIgnoreContent) {
      const localIgnorePath = path.join(gitRoot, '.totemignore');
      let localIgnoreContent = '';
      if (fs.existsSync(localIgnorePath)) {
        localIgnoreContent = fs.readFileSync(localIgnorePath, 'utf-8');
      }

      const localLines = new Set(localIgnoreContent.split('\n').map((l) => l.trim()));
      const newLines = packIgnoreContent
        .split('\n')
        .filter((l: string) => l.trim() && !localLines.has(l.trim()));
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
