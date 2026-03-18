import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadCompiledRules } from '@mmnto/totem';

import { bold, dim, log } from '../ui.js';
import { loadConfig, resolveConfigPath } from '../utils.js';

const TAG = '[Explain]';

export async function explainCommand(hash: string): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);

  // Load compiled rules
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const rules = loadCompiledRules(rulesPath);

  if (rules.length === 0) {
    log.error(TAG, 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  // Find matching rule(s) — support partial hash prefix
  const matches = rules.filter((r) => r.lessonHash.startsWith(hash));

  if (matches.length === 0) {
    log.error(TAG, `No rule found matching hash "${hash}".`);
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
  console.error('');
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
  console.error('');
  log.info(TAG, `Message: ${rule.message}`);

  // Try to find the source lesson file
  const lessonsDir = path.join(totemDir, 'lessons');
  const lessonFile = path.join(lessonsDir, `lesson-${rule.lessonHash}.md`);

  if (fs.existsSync(lessonFile)) {
    console.error('');
    log.info(TAG, `${bold('Source lesson:')} .totem/lessons/lesson-${rule.lessonHash}.md`);
    console.error('');
    const content = fs.readFileSync(lessonFile, 'utf-8');
    // Print lesson content with light formatting
    console.error(content.trim());
  } else {
    // Try searching all lesson files for the heading
    let found = false;
    if (fs.existsSync(lessonsDir)) {
      const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(lessonsDir, file), 'utf-8');
        if (content.includes(rule.lessonHeading)) {
          console.error('');
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
            console.error('');
            console.error(section.join('\n').trim());
          }
          found = true;
          break;
        }
      }
    }
    if (!found) {
      console.error('');
      log.dim(TAG, 'Source lesson file not found. It may have been manually removed.');
    }
  }

  // File glob info
  if (rule.fileGlobs && rule.fileGlobs.length > 0) {
    console.error('');
    log.info(TAG, `${bold('Applies to:')} ${rule.fileGlobs.join(', ')}`);
  }

  console.error('');
}
