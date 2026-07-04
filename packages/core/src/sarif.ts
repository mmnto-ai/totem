import { randomBytes } from 'node:crypto';

import type { CompiledRule, Violation } from './compiler.js';
import { TotemCompileError } from './errors.js';

/** Default rule category when none is specified on the compiled rule. */
export const DEFAULT_RULE_CATEGORY = 'architecture';

// ─── SARIF 2.1.0 Types (minimal subset) ─────────────

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifReportingDescriptor[];
      properties: Record<string, unknown>;
    };
  };
  results: SarifResult[];
  invocations: SarifInvocation[];
}

export interface SarifReportingDescriptor {
  id: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  properties?: Record<string, unknown>;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: SarifLocation[];
  /** SARIF properties bag — Trap Ledger metadata */
  properties?: Record<string, unknown>;
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number };
  };
}

export interface SarifInvocation {
  executionSuccessful: boolean;
  properties?: Record<string, unknown>;
}

// ─── Options ─────────────────────────────────────────

export interface SarifOptions {
  /** Tool version (e.g., "0.31.0") */
  version: string;
  /** Git commit SHA being evaluated */
  commitHash?: string;
}

// ─── Builder ─────────────────────────────────────────

/**
 * Build a unique, stable rule ID from a CompiledRule.
 * Format: `totem/<lessonHash>` — deterministic across runs.
 */
export function ruleId(rule: CompiledRule): string {
  return `totem/${rule.lessonHash}`;
}

// ─── Unicode well-forming (mmnto-ai/totem#2296) ─────────

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
// U+FFFD REPLACEMENT CHARACTER, written as a literal rather than
// String.fromCharCode(0xfffd) so production source stays free of the
// agent-security "obfuscated string assembly" primitive (rule
// dd24f87f46e65812). The test twin builds lone surrogates via fromCharCode,
// which is legal there — that rule excludes `**/*.test.*`.
const UNICODE_REPLACEMENT_CHAR = '�';

/**
 * Replace unpaired UTF-16 surrogate code units with U+FFFD so a string is
 * well-formed Unicode. Lone surrogates are legal in JS strings and the SARIF
 * file we emit parses fine, but `github/codeql-action/upload-sarif` re-serializes
 * the document (fingerprint injection) with JSON.stringify and GitHub's SARIF
 * ingestion parser rejects the resulting bare `\ud83c`-style escapes ("unexpected
 * end of hex escape"), silently dropping the entire analysis under
 * continue-on-error (mmnto-ai/totem#2296). Frozen rule patterns encode astral
 * ranges as surrogate-pair ranges (e.g. the emoji-in-markdown detector), which
 * leaves lone surrogates in `pattern`. Well-forming is lossless for enforcement —
 * the SARIF pattern/description fields are documentation, not executable, and the
 * compiled rules themselves are never touched (compile freeze unaffected).
 *
 * Implemented by hand rather than via `String.prototype.toWellFormed()` (Node ≥
 * 20) because the workspace targets the ES2022 lib, which does not type it.
 */
export function wellFormedUnicode(value: string): string {
  // Fast path: the overwhelming majority of strings carry no surrogate code
  // units at all — scan once and return the original (no reallocation) when
  // there is nothing to well-form (mmnto-ai/totem#2300 review).
  let needsWork = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= HIGH_SURROGATE_MIN && code <= LOW_SURROGATE_MAX) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) return value;

  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX) {
      const next = value.charCodeAt(i + 1);
      if (next >= LOW_SURROGATE_MIN && next <= LOW_SURROGATE_MAX) {
        // Valid surrogate pair — keep both code units.
        out += value.charAt(i) + value.charAt(i + 1);
        i++;
      } else {
        // High surrogate with no following low surrogate (includes end-of-string).
        out += UNICODE_REPLACEMENT_CHAR;
      }
    } else if (code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX) {
      // Low surrogate with no preceding high surrogate.
      out += UNICODE_REPLACEMENT_CHAR;
    } else {
      out += value.charAt(i);
    }
  }
  return out;
}

/**
 * Convert Totem violations + rules into a SARIF 2.1.0 log.
 * Produces output compatible with `github/codeql-action/upload-sarif`.
 */
export function buildSarifLog(
  violations: Violation[],
  rules: CompiledRule[],
  options: SarifOptions,
): SarifLog {
  // Deduplicate rules by lessonHash (same rule can fire multiple times)
  const ruleMap = new Map<string, CompiledRule>();
  for (const rule of rules) {
    ruleMap.set(rule.lessonHash, rule);
  }

  const uniqueRules = [...ruleMap.values()];
  const ruleIndexMap = new Map<string, number>();
  const sarifRules: SarifReportingDescriptor[] = uniqueRules.map((rule, i) => {
    ruleIndexMap.set(rule.lessonHash, i);
    return {
      id: ruleId(rule),
      shortDescription: { text: wellFormedUnicode(rule.message) },
      fullDescription: {
        text: wellFormedUnicode(
          `Lesson: "${rule.lessonHeading}"\nPattern: /${rule.pattern}/\nEngine: ${rule.engine}`,
        ),
      },
      helpUri: `https://github.com/mmnto-ai/totem/wiki/rules#${rule.lessonHash}`,
      properties: {
        engine: rule.engine,
        pattern: wellFormedUnicode(rule.pattern),
        category: rule.category ?? DEFAULT_RULE_CATEGORY,
        ...(rule.fileGlobs ? { fileGlobs: rule.fileGlobs.map(wellFormedUnicode) } : {}),
      },
    };
  });

  const results: SarifResult[] = violations.map((v) => {
    const idx = ruleIndexMap.get(v.rule.lessonHash);
    if (idx === undefined) {
      throw new TotemCompileError(
        `SARIF builder: no rule index for lessonHash ${v.rule.lessonHash}`,
        'This is an internal error — the compiled rules may be corrupted. Run `totem compile --force`.',
      );
    }
    return {
      ruleId: ruleId(v.rule),
      ruleIndex: idx,
      level: v.rule.severity ?? 'error',
      message: {
        text: wellFormedUnicode(
          `${v.rule.message}\n\nMatched: \`${v.line.trim()}\`\nLesson: "${v.rule.lessonHeading}"\nRule: \`totem/${v.rule.lessonHash}\``,
        ),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: v.file },
            region: { startLine: v.lineNumber },
          },
        },
      ],
      properties: {
        eventId: `${v.rule.lessonHash}-${Date.now()}-${randomBytes(4).toString('hex')}`,
        ruleCategory: v.rule.category ?? DEFAULT_RULE_CATEGORY,
        timestamp: new Date().toISOString(),
        lessonHash: v.rule.lessonHash,
      },
    };
  });

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'totem-lint',
            version: options.version,
            informationUri: 'https://github.com/mmnto-ai/totem',
            rules: sarifRules,
            properties: {
              llm_calls: 0,
              ...(options.commitHash ? { commit_hash: options.commitHash } : {}),
            },
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: violations.length === 0,
            properties: {
              rules_enforced: uniqueRules.length,
              violations_found: violations.length,
            },
          },
        ],
      },
    ],
  };
}
