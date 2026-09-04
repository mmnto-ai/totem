import * as fs from 'node:fs';
import * as path from 'node:path';

import { isActiveCompiledRule, loadCompiledRulesFile } from './compiler.js';
import type { TotemConfig } from './config-schema.js';
import { getConfigTier } from './config-schema.js';

export interface ProjectDescription {
  project: string;
  description?: string;
  tier: 'lite' | 'standard' | 'full';
  /**
   * The ACTIVE compiled-rule count — the set `totem lint` enforces and
   * `totem status` reports, resolved through the same predicate as lint's
   * loader (`isActiveCompiledRule`, mmnto-ai/totem#2765). Before that fix this
   * was the raw file total, which no enforcement surface counts.
   */
  rules: number;
  /** Every entry in `compiled-rules.json`, whatever its status — the raw total the banner used to print. */
  rulesCompiled: number;
  /** Inert entries by status; `rules + rulesArchived + rulesUntested + rulesPendingVerification === rulesCompiled`. */
  rulesArchived: number;
  rulesUntested: number;
  rulesPendingVerification: number;
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

  // Rule counts (mmnto-ai/totem#2765). `rules` is the ACTIVE set — what
  // `totem lint` enforces and `totem status` reports — derived through the
  // SAME predicate lint's loader applies (`isActiveCompiledRule`, the
  // mmnto-ai/totem#1345 status filter), so the orientation banner and the
  // enforcement surfaces agree by construction. mmnto-ai/totem#1884 R1 fixed
  // this block's access pattern (`parsed.rules`, not a bare array) but the
  // number it then counted was still the RAW total, which no enforcement
  // surface counts: 485 here against lint's 385. The raw total stays, labelled,
  // as `rulesCompiled` with the inert split beside it, so the archived mass
  // does not vanish from the banner — it stops posing as enforced. The file is
  // read through the schema-validating loader lint and status use; a missing
  // or unreadable file reports zeros, and a sensor never throws.
  let rules = 0;
  let rulesCompiled = 0;
  let rulesArchived = 0;
  let rulesUntested = 0;
  let rulesPendingVerification = 0;
  try {
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    if (fs.existsSync(rulesPath)) {
      const file = loadCompiledRulesFile(rulesPath);
      rulesCompiled = file.rules.length;
      for (const rule of file.rules) {
        if (isActiveCompiledRule(rule)) rules += 1;
        else if (rule.status === 'archived') rulesArchived += 1;
        else if (rule.status === 'untested-against-codebase') rulesUntested += 1;
        else rulesPendingVerification += 1;
      }
    }
    // totem-context: intentional — describe is a read-only sensor: a malformed or schema-invalid compiled-rules.json reports zeros here, exactly as `totem status` falls back for the same file, and fails LOUD in lint's own loader, which is the surface whose job that is (mmnto-ai/totem#1884, mmnto-ai/totem#2765)
  } catch {
    rules = 0;
    rulesCompiled = 0;
    rulesArchived = 0;
    rulesUntested = 0;
    rulesPendingVerification = 0;
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

  return {
    project,
    description,
    tier,
    rules,
    rulesCompiled,
    rulesArchived,
    rulesUntested,
    rulesPendingVerification,
    lessons,
    targets,
    partitions,
    hooks,
  };
}
