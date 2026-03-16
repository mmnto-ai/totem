/**
 * `totem link <path>` — Link a neighboring repository's lessons into this project.
 *
 * Adds the linked repo's .totem/lessons as an ingest target in totem.config.ts.
 * After linking, `totem sync` will index both local and linked lessons.
 */

export interface LinkOptions {
  unlink?: boolean;
}

export async function linkCommand(targetPath: string, options: LinkOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { resolveConfigPath } = await import('../utils.js');

  const TAG = 'Link';
  const cwd = process.cwd();

  // Resolve the target path relative to cwd
  const resolved = path.resolve(cwd, targetPath);
  const relative = path.relative(cwd, resolved).replace(/\\/g, '/');

  // Validate target has a .totem directory
  const targetTotemDir = path.join(resolved, '.totem');
  if (!fs.existsSync(targetTotemDir)) {
    throw new Error(
      '[Totem Error] Target directory does not contain a .totem/ folder.\n' +
        `Checked: ${targetTotemDir}\n` +
        'Run `totem init` in the target project first.',
    );
  }

  // Read current config
  const configPath = resolveConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new Error('[Totem Error] No totem.config.ts found. Run `totem init` first.');
  }

  const configContent = fs.readFileSync(configPath, 'utf-8');

  // Build the glob patterns for the linked repo's lessons
  const lessonGlob = relative + '/.totem/lessons/*.md';
  const legacyGlob = relative + '/.totem/lessons.md';

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

  // Add linked targets to the config
  // Find the targets array and append
  const targetsMatch = configContent.indexOf('targets: [');
  if (targetsMatch === -1) {
    throw new Error(
      '[Totem Error] Could not find `targets: [` in totem.config.ts. Is the config valid?',
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
    throw new Error('[Totem Error] Could not parse targets array in totem.config.ts.');
  }

  const newTargets = `
    // Linked: ${relative}
    { glob: '${lessonGlob}', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '${legacyGlob}', type: 'lesson', strategy: 'markdown-heading' },
  `;

  const updated = configContent.slice(0, insertIdx) + newTargets + configContent.slice(insertIdx);

  fs.writeFileSync(configPath, updated, 'utf-8');
  log.success(TAG, `Linked ${relative}`);
  log.info(TAG, `Added lesson targets from ${relative}/.totem/`);
  log.dim(TAG, 'Run `totem sync` to index the linked lessons.');
}
