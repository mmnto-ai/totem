/**
 * `totem link <path>` — Link a neighboring repository's lessons into this project.
 *
 * Adds the linked repo's .totem/lessons as an ingest target in totem.config.ts.
 * After linking, `totem sync` will index both local and linked lessons.
 */

export interface LinkOptions {
  unlink?: boolean;
  yes?: boolean;
}

export async function linkCommand(targetPath: string, options: LinkOptions): Promise<void> {
  const { TotemConfigError, TotemParseError } = await import('@mmnto/totem');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const TAG = 'Link';
  const cwd = process.cwd();

  // Resolve the target path relative to cwd
  const resolved = path.resolve(cwd, targetPath);
  const relative = path.relative(cwd, resolved).replace(/\\/g, '/');

  // Read current config
  const configPath = resolveConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new TotemConfigError(
      'No totem.config.ts found.',
      'Run `totem init` first to create a configuration file.',
      'CONFIG_MISSING',
    );
  }

  // The Totem directory to look for in the TARGET, and to name in the ingest
  // globs written below — the configured value, not a hardcoded `.totem`
  // (mmnto-ai/totem#2692 C5). Read from THIS repo's config: the two sides of a
  // cohort link share a convention, and a target with a different layout is the
  // separate cross-repo-config question the slice leaves open. Falls back to the
  // default when the config will not load — the existence check below then says
  // exactly which path was probed.
  let totemDirName = '.totem';
  try {
    const linkConfig = await loadConfig(configPath);
    if (typeof linkConfig.totemDir === 'string' && linkConfig.totemDir.length > 0) {
      totemDirName = linkConfig.totemDir.replace(/\\/g, '/').replace(/\/+$/, '');
    }
    // totem-context: intentional cleanup — an unloadable config degrades to the default directory name; the existence check below reports the exact path probed, so nothing is guessed silently.
  } catch {
    totemDirName = '.totem';
  }

  // Validate target has a Totem directory
  const targetTotemDir = path.join(resolved, totemDirName);
  if (!fs.existsSync(targetTotemDir)) {
    throw new TotemConfigError(
      `Target directory does not contain a ${totemDirName}/ folder. Checked: ${targetTotemDir}`,
      'Run `totem init` in the target project first.',
      'CONFIG_MISSING',
    );
  }

  const configContent = fs.readFileSync(configPath, 'utf-8');

  // Build the glob patterns for the linked repo's lessons
  const lessonGlob = `${relative}/${totemDirName}/lessons/*.md`;
  const legacyGlob = `${relative}/${totemDirName}/lessons.md`;

  if (options.unlink) {
    // Remove linked targets
    if (!configContent.includes(lessonGlob)) {
      log.warn(TAG, `${relative} is not linked.`);
      return;
    }

    let updated = configContent;
    // Remove the comment, target lines, and surrounding whitespace
    const escapedRelative = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedLesson = lessonGlob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedLegacy = legacyGlob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    updated = updated.replace(new RegExp(`\\s*// Linked: ${escapedRelative}\\n?`, 'g'), '');
    updated = updated.replace(new RegExp(`\\s*\\{[^}]*${escapedLesson}[^}]*\\},?\\n?`, 'g'), '');
    updated = updated.replace(new RegExp(`\\s*\\{[^}]*${escapedLegacy}[^}]*\\},?\\n?`, 'g'), '');

    fs.writeFileSync(configPath, updated, 'utf-8');
    log.success(TAG, `Unlinked ${relative}`);
    log.dim(TAG, 'Run `totem sync` to rebuild the index.');
    return;
  }

  // Check if already linked
  if (configContent.includes(lessonGlob)) {
    log.warn(TAG, `${relative} is already linked.`);
    return;
  }

  // Security gate: cross-trust-boundary consent (Proposal 067)
  if (!options.yes) {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    log.warn(TAG, 'You are creating a cross-trust-boundary link.');
    log.warn(
      TAG,
      'AI agents in this repository will gain read-access to the linked index via MCP.',
    );
    log.warn(TAG, 'Do not link private/corporate knowledge to public or untrusted repositories.');
    const answer = await new Promise<string>((resolve) => {
      rl.question("\n[Totem] Type 'I understand' to proceed: ", resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'i understand') {
      log.info(TAG, 'Link cancelled.');
      return;
    }
  }

  // Add linked targets to the config
  // Find the targets array and append
  const targetsMatch = configContent.indexOf('targets: [');
  if (targetsMatch === -1) {
    throw new TotemParseError(
      'Could not find `targets: [` in totem.config.ts.',
      'Ensure totem.config.ts contains a valid `targets` array. Re-run `totem init` to regenerate.',
    );
  }

  // Find the closing bracket of the targets array
  let depth = 0;
  let insertIdx = -1;
  for (let i = targetsMatch + 'targets: ['.length; i < configContent.length; i++) {
    if (configContent[i] === '[') depth++;
    if (configContent[i] === ']') {
      if (depth === 0) {
        insertIdx = i;
        break;
      }
      depth--;
    }
  }

  if (insertIdx === -1) {
    throw new TotemParseError(
      'Could not parse targets array in totem.config.ts.',
      'Ensure the `targets` array has valid syntax with matching brackets. Re-run `totem init` to regenerate.',
    );
  }

  const newTargets = `
    // Linked: ${relative}
    { glob: '${lessonGlob}', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '${legacyGlob}', type: 'lesson', strategy: 'markdown-heading' },
  `;

  const updated = configContent.slice(0, insertIdx) + newTargets + configContent.slice(insertIdx);

  fs.writeFileSync(configPath, updated, 'utf-8');
  log.success(TAG, `Linked ${relative}`);
  log.info(TAG, `Added targets from ${relative}/${totemDirName}/`);
  log.dim(TAG, 'Run `totem sync` to rebuild the index.');
}
