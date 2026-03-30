import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TotemConfig } from './config-schema.js';
import { getConfigTier } from './config-schema.js';

export interface ProjectDescription {
  project: string;
  description?: string;
  tier: 'lite' | 'standard' | 'full';
  rules: number;
  lessons: number;
  targets: string[];
  partitions: Record<string, string[]>;
  hooks: string[];
}

/**
 * Gather project description from filesystem — no LLM, no embedder, fast.
 * Requires a pre-loaded config and the resolved config root directory.
 */
export function describeProject(config: TotemConfig, configRoot: string): ProjectDescription {
  const totemDir = path.join(configRoot, config.totemDir);

  // Project name + description from package.json
  let project = path.basename(configRoot);
  let description: string | undefined;
  try {
    const pkgPath = path.join(configRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) project = pkg.name;
      if (pkg.description) description = pkg.description;
    }
  } catch {
    // package.json missing or malformed — use directory name
  }

  const tier = getConfigTier(config);

  // Rule count from compiled rules
  let rules = 0;
  try {
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    if (fs.existsSync(rulesPath)) {
      const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
      rules = Array.isArray(parsed) ? parsed.length : 0;
    }
  } catch {
    // compiled-rules.json missing or malformed
  }

  // Lesson count
  let lessons = 0;
  try {
    const lessonsDir = path.join(totemDir, 'lessons');
    if (fs.existsSync(lessonsDir)) {
      lessons = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md')).length;
    }
  } catch {
    // lessons dir missing or unreadable
  }

  const targets = config.targets.map((t) => `${t.glob} (${t.type}/${t.strategy})`);
  const partitions: Record<string, string[]> = config.partitions ?? {};

  // Git hooks
  const hooks: string[] = [];
  try {
    const hooksDir = path.join(configRoot, '.git', 'hooks');
    if (fs.existsSync(hooksDir)) {
      for (const file of fs.readdirSync(hooksDir)) {
        if (file.endsWith('.sample')) continue;
        const stat = fs.statSync(path.join(hooksDir, file));
        if (stat.isFile()) hooks.push(file);
      }
    }
  } catch {
    // .git/hooks unreadable
  }

  return { project, description, tier, rules, lessons, targets, partitions, hooks };
}
