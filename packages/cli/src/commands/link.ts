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
  const { isGlobalConfigPath, loadConfig, resolveConfigPath } = await import('../utils.js');

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
  // globs written below — the TARGET repo's OWN configured value, not a
  // hardcoded `.totem` and not this repo's setting (mmnto-ai/totem#2692 C5,
  // amendment A3): the two sides of a link may configure differently, and only
  // the target's config knows where its lessons live. Repo-local only — a global
  // `~/.totem/` profile describes itself, never a linked repo. A target with no
  // config (`resolveConfigPath` throws) or an unloadable one is probed at the
  // default; the existence check below names the exact path probed either way.
  let totemDirName = '.totem';
  let targetConfiguredDir: string | undefined;
  try {
    const targetConfigPath = resolveConfigPath(resolved);
    if (!isGlobalConfigPath(targetConfigPath)) {
      const targetConfig = await loadConfig(targetConfigPath);
      if (typeof targetConfig.totemDir === 'string') targetConfiguredDir = targetConfig.totemDir;
    }
    // totem-context: intentional cleanup — a target with no config or an unloadable one degrades to the default directory name; the existence check below reports the exact path probed, so nothing is guessed silently.
  } catch {
    targetConfiguredDir = undefined;
  }
  if (targetConfiguredDir !== undefined) {
    // The name is written VERBATIM into this repo's config as a glob, so a value
    // that names the target itself or escapes it (`.`, `..`) would ingest a tree
    // the consent prompt below never named (mmnto-ai/totem#2692 amendment A7).
    const name = targetConfiguredDir.replace(/\\/g, '/').replace(/\/+$/, '');
    // Segment test backed by resolved-path containment against the TARGET root
    // (path.resolve + path.relative — the repo's stated guideline for configured
    // paths; CodeRabbit on mmnto-ai/totem#2701).
    const inside = path.relative(resolved, path.resolve(resolved, name)).replace(/\\/g, '/');
    if (
      name === '' ||
      name === '.' ||
      name.split('/').includes('..') ||
      inside === '' ||
      inside.startsWith('..') ||
      path.isAbsolute(inside)
    ) {
      throw new TotemConfigError(
        `The target's totemDir (${JSON.stringify(targetConfiguredDir)}) names the target itself or escapes it; a link ingests a directory INSIDE the target.`,
        'Set a repo-local `totemDir` inside the target project, or link the directory you mean directly.',
        'CONFIG_INVALID',
      );
    }
    // The name is written into an INGEST GLOB, where `*`, `?`, `[`, `{`, `(` and `!`
    // are pattern syntax: `knowledge*` would ingest every sibling that matches
    // (Greptile P1 on mmnto-ai/totem#2701). Refuse rather than escape — the
    // hooks accept these characters, a glob cannot carry them safely.
    if (/[*?[\]{}()!]/.test(name)) {
      throw new TotemConfigError(
        `The target's totemDir (${JSON.stringify(targetConfiguredDir)}) contains glob metacharacters; a link writes it into an ingest glob, where they would match other directories.`,
        'Rename the target directory to a plain path, or link the directory you mean directly.',
        'CONFIG_INVALID',
      );
    }
    totemDirName = name;
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
    // Remove linked targets. The link is keyed by the TARGET path, not by the
    // directory name it had when linked: a link made while the target used
    // `.totem` must still unlink after the target moved to `knowledge`, so the
    // generated globs are matched by shape — `<relative>/<any dir>/lessons…` —
    // and by the stable `// Linked: <relative>` record (CodeRabbit on
    // mmnto-ai/totem#2701).
    const escapedRelative = relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anyDirLesson = `${escapedRelative}/[^'"]+/lessons/\\*\\.md`;
    const anyDirLegacy = `${escapedRelative}/[^'"]+/lessons\\.md`;
    const linked =
      configContent.includes(`// Linked: ${relative}`) ||
      new RegExp(anyDirLesson).test(configContent);
    if (!linked) {
      log.warn(TAG, `${relative} is not linked.`);
      return;
    }

    let updated = configContent;
    // Remove the comment, target lines, and surrounding whitespace
    updated = updated.replace(new RegExp(`\\s*// Linked: ${escapedRelative}\\n?`, 'g'), '');
    updated = updated.replace(new RegExp(`\\s*\\{[^}]*${anyDirLesson}[^}]*\\},?\\n?`, 'g'), '');
    updated = updated.replace(new RegExp(`\\s*\\{[^}]*${anyDirLegacy}[^}]*\\},?\\n?`, 'g'), '');

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
