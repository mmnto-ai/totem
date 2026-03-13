import type { CompiledRule, Violation } from './compiler.js';

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
  properties?: Record<string, unknown>;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning' | 'note';
  message: { text: string };
  locations: SarifLocation[];
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
      shortDescription: { text: rule.message },
      fullDescription: { text: `Lesson: ${rule.lessonHeading}` },
      properties: {
        engine: rule.engine,
        pattern: rule.pattern,
        ...(rule.fileGlobs ? { fileGlobs: rule.fileGlobs } : {}),
      },
    };
  });

  const results: SarifResult[] = violations.map((v) => ({
    ruleId: ruleId(v.rule),
    ruleIndex: ruleIndexMap.get(v.rule.lessonHash) ?? 0,
    level: 'error',
    message: { text: `${v.rule.message}\nMatched: \`${v.line.trim()}\`` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: v.file },
          region: { startLine: v.lineNumber },
        },
      },
    ],
  }));

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'totem-shield',
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
