/**
 * ESLint config rule importer (Pipeline 4).
 * Parses ESLint JSON config files and extracts importable rules.
 * Only imports rules with string/regex patterns in config:
 * - no-restricted-imports (paths/patterns)
 * - no-restricted-globals (string array)
 * - no-restricted-syntax (selector strings)
 * - no-restricted-properties (object/property pairs)
 */

import { hashLesson } from './compiler.js';
import type { CompiledRule } from './compiler-schema.js';

// ─── Types ──────────────────────────────────────────

export interface EslintImportResult {
  rules: CompiledRule[];
  skipped: { rule: string; reason: string }[];
}

// ─── Importable rule handlers ───────────────────────

type RuleHandler = (
  ruleName: string,
  config: unknown,
  severity: 'error' | 'warning',
  now: string,
) => CompiledRule[];

function handleRestrictedImports(
  ruleName: string,
  config: unknown,
  severity: 'error' | 'warning',
  now: string,
): CompiledRule[] {
  const rules: CompiledRule[] = [];

  // Config comes as args array: [{paths: [...], patterns: [...]}]
  const raw = Array.isArray(config) ? config[0] : config;
  if (typeof raw === 'object' && raw !== null) {
    const cfg = raw as Record<string, unknown>;

    // Handle paths: ["lodash", "underscore"] or [{name: "lodash"}]
    const paths = Array.isArray(cfg.paths) ? cfg.paths : [];
    for (const p of paths) {
      const name =
        typeof p === 'string'
          ? p
          : typeof p === 'object' && p !== null && 'name' in p
            ? String((p as Record<string, unknown>).name)
            : null;
      if (!name) continue;
      const heading = `[eslint] ${ruleName}: ${name}`;
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push({
        lessonHash: hashLesson(heading, `Import of '${name}' is restricted`),
        lessonHeading: heading,
        pattern: `from\\s+['"]${escapedName}`,
        message: `Import of '${name}' is restricted by ESLint config.`,
        engine: 'regex',
        severity,
        compiledAt: now,
        createdAt: now,
        fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      });
    }

    // Handle patterns: ["internal/*"]
    const patterns = Array.isArray(cfg.patterns) ? cfg.patterns : [];
    for (const p of patterns) {
      const pat =
        typeof p === 'string'
          ? p
          : typeof p === 'object' && p !== null && 'group' in p
            ? String((p as Record<string, unknown>).group)
            : null;
      if (!pat) continue;
      const heading = `[eslint] ${ruleName}: ${pat}`;
      // Convert glob-like pattern to regex
      const regexPat = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      rules.push({
        lessonHash: hashLesson(heading, `Import matching '${pat}' is restricted`),
        lessonHeading: heading,
        pattern: `from\\s+['"]${regexPat}`,
        message: `Import matching '${pat}' is restricted by ESLint config.`,
        engine: 'regex',
        severity,
        compiledAt: now,
        createdAt: now,
        fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      });
    }
  }

  return rules;
}

function handleRestrictedGlobals(
  _ruleName: string,
  config: unknown,
  severity: 'error' | 'warning',
  now: string,
): CompiledRule[] {
  const rules: CompiledRule[] = [];

  if (Array.isArray(config)) {
    for (const item of config) {
      const name =
        typeof item === 'string'
          ? item
          : typeof item === 'object' && item !== null && 'name' in item
            ? String((item as Record<string, unknown>).name)
            : null;
      if (!name) continue;
      const heading = `[eslint] no-restricted-globals: ${name}`;
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push({
        lessonHash: hashLesson(heading, `Use of global '${name}' is restricted`),
        lessonHeading: heading,
        pattern: `\\b${escapedName}\\b`,
        message: `Use of global '${name}' is restricted by ESLint config.`,
        engine: 'regex',
        severity,
        compiledAt: now,
        createdAt: now,
        fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      });
    }
  }

  return rules;
}

const IMPORTABLE_HANDLERS: Record<string, RuleHandler> = {
  'no-restricted-imports': handleRestrictedImports,
  '@typescript-eslint/no-restricted-imports': handleRestrictedImports,
  'no-restricted-globals': handleRestrictedGlobals,
};

// ─── Parser ─────────────────────────────────────────

/** Parse ESLint JSON config and extract importable rules. */
export function parseEslintConfig(jsonContent: string): EslintImportResult {
  const rules: CompiledRule[] = [];
  const skipped: { rule: string; reason: string }[] = [];

  let doc: unknown;
  try {
    doc = JSON.parse(jsonContent);
  } catch {
    return { rules, skipped: [{ rule: '(root)', reason: 'Invalid JSON' }] };
  }

  if (!doc || typeof doc !== 'object') {
    return { rules, skipped: [{ rule: '(root)', reason: 'Config is not an object' }] };
  }

  const config = doc as Record<string, unknown>;
  const rulesObj = config.rules as Record<string, unknown> | undefined;

  if (!rulesObj || typeof rulesObj !== 'object') {
    return { rules, skipped: [{ rule: '(root)', reason: 'No "rules" object found in config' }] };
  }

  const now = new Date().toISOString();

  for (const [ruleName, ruleConfig] of Object.entries(rulesObj)) {
    // ESLint rule config: "off" | "warn" | "error" | 0 | 1 | 2 | [severity, ...options]
    let severity: 'error' | 'warning' | 'off';
    let options: unknown;

    if (Array.isArray(ruleConfig)) {
      const sev = ruleConfig[0];
      severity = parseSeverity(sev);
      options = ruleConfig.slice(1);
    } else {
      severity = parseSeverity(ruleConfig);
      options = undefined;
    }

    if (severity === 'off') continue;

    const handler = IMPORTABLE_HANDLERS[ruleName];
    if (!handler) {
      skipped.push({
        rule: ruleName,
        reason: 'Not an importable rule type (AST-based ESLint rules cannot be converted to regex)',
      });
      continue;
    }

    const imported = handler(ruleName, options, severity, now);
    if (imported.length === 0) {
      skipped.push({ rule: ruleName, reason: 'No importable patterns found in rule config' });
    } else {
      rules.push(...imported);
    }
  }

  return { rules, skipped };
}

function parseSeverity(sev: unknown): 'error' | 'warning' | 'off' {
  if (sev === 'error' || sev === 2) return 'error';
  if (sev === 'warn' || sev === 1) return 'warning';
  return 'off';
}
