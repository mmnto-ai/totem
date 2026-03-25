const TAG = '[Explain]';

export async function explainCommand(hash: string): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { bold, dim, log } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const { loadCompiledRules } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);

  // Load compiled rules
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const rules = loadCompiledRules(rulesPath);

  if (rules.length === 0) {
    log.error('Totem Error', 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  // Find matching rule(s) — support partial hash prefix
  const lowerHash = hash.toLowerCase();
  const matches = rules.filter((r) => r.lessonHash.toLowerCase().startsWith(lowerHash));

  if (matches.length === 0) {
    log.error('Totem Error', `No rule found matching hash "${hash}".`);
    log.dim(TAG, 'Run `totem compile` to ensure your rules are up to date.');
    return;
  }

  if (matches.length > 1) {
    log.warn(TAG, `Ambiguous hash "${hash}" matches ${matches.length} rules:`);
    for (const m of matches) {
      log.info(TAG, `  ${bold(m.lessonHash)} — ${m.lessonHeading}`);
    }
    log.dim(TAG, 'Use a longer prefix to disambiguate.');
    return;
  }

  const rule = matches[0]!;

  // Display rule details
  process.stderr.write('\n');
  log.info(TAG, `Rule: ${bold(rule.lessonHash)}`);
  log.info(TAG, `Heading: ${bold(rule.lessonHeading)}`);
  log.info(
    TAG,
    `Engine: ${rule.engine} | Severity: ${rule.severity ?? 'warning'} | Category: ${rule.category ?? 'uncategorized'}`,
  );
  log.info(TAG, `Pattern: ${dim(rule.pattern)}`);
  if (rule.astQuery) {
    log.info(TAG, `AST Query: ${dim(rule.astQuery)}`);
  }
  process.stderr.write('\n');
  log.info(TAG, `Message: ${rule.message}`);

  // Try to find the source lesson file
  const lessonsDir = path.join(totemDir, 'lessons');
  const lessonFile = path.join(lessonsDir, `lesson-${rule.lessonHash}.md`);

  if (fs.existsSync(lessonFile)) {
    process.stderr.write('\n');
    log.info(TAG, `${bold('Source lesson:')} .totem/lessons/lesson-${rule.lessonHash}.md`);
    process.stderr.write('\n');
    const content = fs.readFileSync(lessonFile, 'utf-8');
    // Print lesson content with light formatting
    process.stderr.write(content.trim() + '\n');
  } else {
    // Try searching all lesson files for the heading
    let found = false;
    if (fs.existsSync(lessonsDir)) {
      const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(lessonsDir, file), 'utf-8');
        if (content.includes(rule.lessonHeading)) {
          process.stderr.write('\n');
          log.info(TAG, `${bold('Found in:')} .totem/lessons/${file}`);
          // Extract the relevant section
          const lines = content.split('\n');
          const headingIdx = lines.findIndex((l) => l.includes(rule.lessonHeading));
          if (headingIdx >= 0) {
            // Print from heading to next heading or end
            const section: string[] = [];
            for (let i = headingIdx; i < lines.length; i++) {
              if (i > headingIdx && lines[i]!.startsWith('## ')) break;
              section.push(lines[i]!);
            }
            process.stderr.write('\n');
            process.stderr.write(section.join('\n').trim() + '\n');
          }
          found = true;
          break;
        }
      }
    }
    if (!found) {
      process.stderr.write('\n');
      log.dim(TAG, 'Source lesson file not found. It may have been manually removed.');
    }
  }

  // File glob info
  if (rule.fileGlobs && rule.fileGlobs.length > 0) {
    process.stderr.write('\n');
    log.info(TAG, `${bold('Applies to:')} ${rule.fileGlobs.join(', ')}`);
  }

  process.stderr.write('\n');
}
