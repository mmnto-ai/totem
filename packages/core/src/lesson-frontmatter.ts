/**
 * YAML frontmatter extraction and legacy field mapping for lessons.
 * Implements the dual-parse (fail-open) strategy from ADR-070.
 */

import YAML from 'yaml';

import { extractField } from './lesson-pattern.js';
import { type LessonFrontmatter, LessonFrontmatterSchema } from './types.js';

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// Map kebab-case YAML keys (the canonical wire form per item 020) to the
// camelCase schema keys used internally. Item 020 keeps `applies-to:` aligned
// with the prose `**Applies-to:**` form and the upstream-feedback house style;
// the schema stays camelCase per TS conventions.
const WIRE_KEY_REMAP: Record<string, string> = {
  'applies-to': 'appliesTo',
};

function remapWireKeys(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[WIRE_KEY_REMAP[k] ?? k] = v;
  }
  return out;
}

export interface FrontmatterParseResult {
  frontmatter: LessonFrontmatter;
  /** Content after the YAML block (or full content if no YAML) */
  body: string;
  /** Whether YAML frontmatter was detected (even if invalid) */
  hadYaml: boolean;
  /** Whether YAML was both detected AND validated successfully */
  validYaml: boolean;
}

/**
 * Extract YAML frontmatter from lesson content.
 * If YAML is present, parse and validate against the schema.
 * If missing or invalid, return defaults and the full content as body.
 */
export function extractFrontmatter(
  content: string,
  onWarn?: (msg: string) => void,
): FrontmatterParseResult {
  const match = FRONTMATTER_RE.exec(content);

  if (!match) {
    return {
      frontmatter: LessonFrontmatterSchema.parse({}),
      body: content,
      hadYaml: false,
      validYaml: false,
    };
  }

  const yamlBlock = match[1]!;
  const body = content.slice(match[0].length).replace(/^\r?\n/, '');

  try {
    const raw = YAML.parse(yamlBlock);
    const result = LessonFrontmatterSchema.safeParse(remapWireKeys(raw ?? {}));

    if (!result.success) {
      onWarn?.(`Invalid frontmatter: ${result.error.issues.map((i) => i.message).join(', ')}`);
      return {
        frontmatter: LessonFrontmatterSchema.parse({}),
        body,
        hadYaml: true,
        validYaml: false,
      };
    }

    return { frontmatter: result.data, body, hadYaml: true, validYaml: true };
  } catch (err) {
    onWarn?.(
      `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      frontmatter: LessonFrontmatterSchema.parse({}),
      body,
      hadYaml: true,
      validYaml: false,
    };
  }
}

/**
 * Build a LessonFrontmatter from legacy markdown fields.
 * Maps **Tags:**, **Pattern:**, **Engine:**, **Scope:**, **Severity:**, **Applies-to:** into the schema.
 */
export function buildFrontmatterFromLegacy(tags: string[], body: string): LessonFrontmatter {
  const fm: Record<string, unknown> = { tags };

  const pattern = extractField(body, 'Pattern');
  const engine = extractField(body, 'Engine')?.toLowerCase();
  const scope = extractField(body, 'Scope');
  const severity = extractField(body, 'Severity')?.toLowerCase();
  const appliesTo = extractField(body, 'Applies-to');

  if (pattern) {
    const validEngines = ['regex', 'ast', 'ast-grep'];
    fm.compilation = {
      engine: validEngines.includes(engine ?? '') ? engine : 'regex',
      pattern,
    };
  }

  if (scope) {
    fm.scope = {
      globs: scope
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
    };
  }

  if (severity === 'error' || severity === 'warning') {
    fm.severity = severity;
  }

  // Pass the raw prose string through; the schema preprocessor handles
  // splitting, lowercasing, empty-array normalization, and enum validation.
  if (appliesTo !== undefined) {
    fm.appliesTo = appliesTo;
  }

  const result = LessonFrontmatterSchema.safeParse(fm);
  if (!result.success) {
    // Fail-open: return defaults if legacy fields produce invalid schema
    return LessonFrontmatterSchema.parse({});
  }
  return result.data;
}
