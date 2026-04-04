/**
 * ESLint config rule importer (Pipeline 4).
 * Parses ESLint JSON config files and extracts importable rules.
 * Imports rules with string/regex patterns in config:
 * - no-restricted-imports (paths/patterns)
 * - no-restricted-globals (string array)
 * - no-restricted-properties (object.property pairs)
 * - no-restricted-syntax (AST node type selectors → regex approximations)
 */

import { hashLesson, validateRegex } from './compiler.js';
import type { CompiledRule } from './compiler-schema.js';
import { escapeRegex } from './regex-utils.js';

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
      const escapedName = escapeRegex(name);
      rules.push({
        lessonHash: hashLesson(heading, `Import of '${name}' is restricted`),
        lessonHeading: heading,
        pattern: `from\\s+['"]${escapedName}['"/]`,
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
      const regexPat = escapeRegex(pat).replace(/\\\*/g, '.*');
      rules.push({
        lessonHash: hashLesson(heading, `Import matching '${pat}' is restricted`),
        lessonHeading: heading,
        pattern: `from\\s+['"]${regexPat}['"/]`,
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
      const escapedName = escapeRegex(name);
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

function handleRestrictedProperties(
  _ruleName: string,
  config: unknown,
  severity: 'error' | 'warning',
  now: string,
): CompiledRule[] {
  const rules: CompiledRule[] = [];
  if (!Array.isArray(config)) return rules;

  for (const item of config) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const obj = typeof rec.object === 'string' ? rec.object : null;
    const prop = typeof rec.property === 'string' ? rec.property : null;
    if (!obj && !prop) continue;

    const label = obj && prop ? `${obj}.${prop}` : (obj ?? `.${prop}`);
    const heading = `[eslint] no-restricted-properties: ${label}`;
    const msg =
      typeof rec.message === 'string'
        ? rec.message
        : `Use of ${label} is restricted by ESLint config.`;

    let pattern: string;
    if (obj && prop) {
      const eo = escapeRegex(obj);
      const ep = escapeRegex(prop);
      pattern = `(?:^|[^\\w$])${eo}\\s*\\.\\s*${ep}\\b`;
    } else if (obj) {
      const eo = escapeRegex(obj);
      pattern = `(?:^|[^\\w$])${eo}\\b`;
    } else {
      const ep = escapeRegex(prop!);
      pattern = `\\.\\s*${ep}\\b`;
    }

    rules.push({
      lessonHash: hashLesson(heading, msg),
      lessonHeading: heading,
      pattern,
      message: msg,
      engine: 'regex',
      severity,
      compiledAt: now,
      createdAt: now,
      fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    });
  }

  return rules;
}

/**
 * Map common ESTree node type selectors to regex approximations.
 * Only includes selectors with high-confidence regex mappings.
 * Complex or ambiguous selectors are skipped during import.
 */
const SYNTAX_REGEX_MAP: Record<string, string> = {
  ForInStatement: '\\bfor\\s*\\([^)]*\\bin\\b',
  WithStatement: '\\bwith\\s*\\(',
  DebuggerStatement: '\\bdebugger\\b',
};

function handleRestrictedSyntax(
  _ruleName: string,
  config: unknown,
  severity: 'error' | 'warning',
  now: string,
): CompiledRule[] {
  const rules: CompiledRule[] = [];
  if (!Array.isArray(config)) return rules;

  for (const item of config) {
    const selector =
      typeof item === 'string'
        ? item
        : typeof item === 'object' &&
            item !== null &&
            typeof (item as Record<string, unknown>).selector === 'string'
          ? ((item as Record<string, unknown>).selector as string)
          : null;
    if (!selector) continue;

    const pattern = SYNTAX_REGEX_MAP[selector];
    if (!pattern) continue; // Skip complex/unknown selectors silently

    const customMsg =
      typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>).message
        : undefined;
    const heading = `[eslint] no-restricted-syntax: ${selector}`;
    const message =
      typeof customMsg === 'string'
        ? customMsg
        : `Use of '${selector}' is restricted by ESLint config.`;

    rules.push({
      lessonHash: hashLesson(heading, message),
      lessonHeading: heading,
      pattern,
      message,
      engine: 'regex',
      severity,
      compiledAt: now,
      createdAt: now,
      fileGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    });
  }

  return rules;
}

const IMPORTABLE_HANDLERS: Record<string, RuleHandler> = {
  'no-restricted-imports': handleRestrictedImports,
  '@typescript-eslint/no-restricted-imports': handleRestrictedImports,
  'no-restricted-globals': handleRestrictedGlobals,
  'no-restricted-properties': handleRestrictedProperties,
  'no-restricted-syntax': handleRestrictedSyntax,
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
    // Validate each imported rule's regex for syntax and ReDoS safety
    const valid = imported.filter((r) => {
      const v = validateRegex(r.pattern);
      if (!v.valid) {
        skipped.push({
          rule: `${ruleName}: ${r.lessonHeading}`,
          reason: `Invalid regex: ${v.reason}`,
        });
        return false;
      }
      return true;
    });
    if (valid.length === 0 && imported.length === 0) {
      skipped.push({ rule: ruleName, reason: 'No importable patterns found in rule config' });
    } else {
      rules.push(...valid);
    }
  }

  return { rules, skipped };
}

function parseSeverity(sev: unknown): 'error' | 'warning' | 'off' {
  if (sev === 'error' || sev === 2) return 'error';
  if (sev === 'warn' || sev === 1) return 'warning';
  return 'off';
}
