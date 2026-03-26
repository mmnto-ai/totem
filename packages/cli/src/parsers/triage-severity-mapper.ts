import type { NormalizedBotFinding } from './bot-review-parser.js';
import type { TriageCategory } from './triage-types.js';

/** Keyword dictionaries for severity mapping */
export const SECURITY_KEYWORDS = [
  'injection',
  'xss',
  'csrf',
  'redos',
  'shell',
  'exec',
  'spawn',
  'credential',
  'secret',
  'leak',
  'vulnerability',
  'cwe-',
  'security',
  'sanitiz',
  'escap',
  'authori',
  'authenticat',
];

export const ARCHITECTURE_KEYWORDS = [
  'empty catch',
  'validation',
  'zod',
  'type safety',
  'static import',
  'dynamic import',
  'race condition',
  'missing guard',
  'null check',
  'error handling',
  'boundary',
  'coupling',
  'abstraction',
];

export const CONVENTION_KEYWORDS = [
  'tag',
  'log.error',
  'naming',
  'style guide',
  'rule #',
  'convention',
  'formatting',
  'casing',
  'prefix',
  'totem error',
  'styleguide',
];

export const NIT_KEYWORDS = [
  'marketing',
  'copy',
  'rephrase',
  'consider',
  'optional',
  'nitpick',
  'nit',
  'minor',
  'cosmetic',
  'typo',
  'spelling',
  'whitespace',
  'trailing',
];

export function mapToTriageCategory(finding: NormalizedBotFinding): TriageCategory {
  // Only search the body for keywords — NOT severity, which would cause
  // 'minor' severity to match NIT_KEYWORDS and misbucket
  const text = finding.body.toLowerCase();

  // Check in priority order — security first
  if (SECURITY_KEYWORDS.some((kw) => text.includes(kw))) return 'security';
  if (ARCHITECTURE_KEYWORDS.some((kw) => text.includes(kw))) return 'architecture';
  if (CONVENTION_KEYWORDS.some((kw) => text.includes(kw))) return 'convention';
  if (NIT_KEYWORDS.some((kw) => text.includes(kw))) return 'nit';

  // Fall back to bot-assigned severity
  if (finding.severity === 'critical' || finding.severity === 'high') return 'security';
  if (finding.severity === 'major' || finding.severity === 'medium') return 'architecture';
  if (finding.severity === 'minor' || finding.severity === 'low') return 'convention';

  return 'architecture'; // default to architecture (better safe than sorry)
}
