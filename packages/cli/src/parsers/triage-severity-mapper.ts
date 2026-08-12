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

/**
 * Word-bounded keyword test. A bare substring match mis-buckets on innocent
 * containments — `nit` fires inside "defi**nit**ions" (ghcq's stock closing
 * boilerplate) and "u**nit** test", routing real findings to the NITS bucket
 * the command exists to keep clean (mmnto-ai/totem#2626 falsification round,
 * reproduced on 5 of the 7 in-org ghcq comments). `\b` at both ends keeps
 * multi-word keywords ('totem error') and hyphen-adjacent hits working, since
 * hyphens and spaces are non-word characters.
 */
function matchesKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) =>
    new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text),
  );
}

export function mapToTriageCategory(finding: NormalizedBotFinding): TriageCategory {
  // Only search the body for keywords — NOT severity, which would cause
  // 'minor' severity to match NIT_KEYWORDS and misbucket
  const text = finding.body.toLowerCase();

  // Check in priority order — security first
  if (matchesKeyword(text, SECURITY_KEYWORDS)) return 'security';
  if (matchesKeyword(text, ARCHITECTURE_KEYWORDS)) return 'architecture';
  if (matchesKeyword(text, CONVENTION_KEYWORDS)) return 'convention';
  if (matchesKeyword(text, NIT_KEYWORDS)) return 'nit';

  // Fall back to bot-assigned severity
  if (finding.severity === 'critical' || finding.severity === 'high') return 'security';
  if (finding.severity === 'major' || finding.severity === 'medium') return 'architecture';
  if (finding.severity === 'minor' || finding.severity === 'low') return 'convention';

  return 'architecture'; // default to architecture (better safe than sorry)
}
