/**
 * Semgrep YAML rule importer (Pipeline 4).
 * Parses Semgrep rule files and produces CompiledRule objects.
 */

import { parse as parseYaml } from 'yaml';

import { hashLesson, validateRegex } from './compiler.js';
import type { CompiledRule } from './compiler-schema.js';

// ─── Language-to-glob mapping ───────────────────────

const LANGUAGE_GLOBS: Record<string, string[]> = {
  javascript: ['**/*.js', '**/*.jsx'],
  typescript: ['**/*.ts', '**/*.tsx'],
  js: ['**/*.js', '**/*.jsx'],
  ts: ['**/*.ts', '**/*.tsx'],
  python: ['**/*.py'],
  rust: ['**/*.rs'],
  go: ['**/*.go'],
  java: ['**/*.java'],
  ruby: ['**/*.rb'],
  c: ['**/*.c', '**/*.h'],
  cpp: ['**/*.cpp', '**/*.hpp', '**/*.cc'],
};

function languagesToGlobs(languages?: string[]): string[] | undefined {
  if (!languages || languages.length === 0) return undefined;
  const globs: string[] = [];
  for (const lang of languages) {
    const mapped = LANGUAGE_GLOBS[lang.toLowerCase()];
    if (mapped) globs.push(...mapped);
  }
  return globs.length > 0 ? globs : undefined;
}

// ─── Types ──────────────────────────────────────────

export interface SemgrepImportResult {
  rules: CompiledRule[];
  skipped: { id: string; reason: string }[];
}

// ─── Parser ─────────────────────────────────────────

/** Parse Semgrep YAML rules into CompiledRule objects. */
export function parseSemgrepRules(yamlContent: string): SemgrepImportResult {
  const rules: CompiledRule[] = [];
  const skipped: { id: string; reason: string }[] = [];

  let doc: unknown;
  try {
    doc = parseYaml(yamlContent);
  } catch {
    return { rules, skipped: [{ id: '(root)', reason: 'Invalid YAML' }] };
  }

  if (
    !doc ||
    typeof doc !== 'object' ||
    !('rules' in doc) ||
    !Array.isArray((doc as Record<string, unknown>).rules)
  ) {
    return { rules, skipped: [{ id: '(root)', reason: 'No "rules" array found in YAML' }] };
  }

  const now = new Date().toISOString();

  for (const entry of (doc as { rules: unknown[] }).rules) {
    if (!entry || typeof entry !== 'object') continue;
    const rule = entry as Record<string, unknown>;

    const id = typeof rule.id === 'string' ? rule.id : undefined;
    if (!id) {
      skipped.push({ id: '(unknown)', reason: 'Missing rule id' });
      continue;
    }

    // Extract pattern — prefer pattern-regex, fall back to simple string pattern
    let pattern: string | undefined;
    if (typeof rule['pattern-regex'] === 'string') {
      pattern = rule['pattern-regex'];
    } else if (typeof rule.pattern === 'string' && !rule.patterns && !rule['pattern-either']) {
      // Simple string patterns like "eval(...)" — convert to regex
      // Strip Semgrep metavariables ($X, $...) before escaping, replace `...` with `.*`
      const cleaned = rule.pattern.replace(/\$\w+/g, '\\w+');
      pattern = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.\\\.\\\./g, '.*');
    }

    if (!pattern) {
      const reason = rule.patterns
        ? 'Compound pattern (patterns/pattern-either)'
        : 'No pattern or pattern-regex field';
      skipped.push({ id, reason });
      continue;
    }

    // Validate regex for syntax and ReDoS safety
    const validation = validateRegex(pattern);
    if (!validation.valid) {
      skipped.push({ id, reason: `Invalid regex: ${validation.reason}` });
      continue;
    }

    const message = typeof rule.message === 'string' ? rule.message : `[semgrep] ${id}`;

    // Severity
    const sevRaw = typeof rule.severity === 'string' ? rule.severity.toUpperCase() : 'WARNING';
    const severity: 'error' | 'warning' = sevRaw === 'ERROR' ? 'error' : 'warning';

    // File globs from languages + paths
    const languages = Array.isArray(rule.languages)
      ? rule.languages.filter((l): l is string => typeof l === 'string')
      : undefined;
    const langGlobs = languagesToGlobs(languages);

    const paths = rule.paths as Record<string, unknown> | undefined;
    const includeGlobs =
      paths && Array.isArray(paths.include)
        ? paths.include.filter((p): p is string => typeof p === 'string')
        : [];
    const excludeGlobs =
      paths && Array.isArray(paths.exclude)
        ? paths.exclude.filter((p): p is string => typeof p === 'string').map((p) => `!${p}`)
        : [];

    const fileGlobs = [
      ...(includeGlobs.length > 0 ? includeGlobs : (langGlobs ?? [])),
      ...excludeGlobs,
    ];

    // Category from metadata (validate against allowed values)
    const VALID_CATEGORIES = new Set(['security', 'architecture', 'style', 'performance']);
    const metadata = rule.metadata as Record<string, unknown> | undefined;
    const rawCategory =
      metadata && typeof metadata.category === 'string' ? metadata.category : undefined;
    const category =
      rawCategory && VALID_CATEGORIES.has(rawCategory)
        ? (rawCategory as CompiledRule['category'])
        : undefined;

    const heading = `[semgrep] ${id}`;
    rules.push({
      lessonHash: hashLesson(heading, message),
      lessonHeading: heading,
      pattern,
      message,
      engine: 'regex',
      severity,
      compiledAt: now,
      createdAt: now,
      ...(fileGlobs.length > 0 ? { fileGlobs } : {}),
      ...(category ? { category } : {}),
    });
  }

  return { rules, skipped };
}
