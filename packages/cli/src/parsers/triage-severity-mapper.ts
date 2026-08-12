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
 * Keyword test with an ASYMMETRIC boundary: the keyword must start at a
 * letter/number boundary but may extend rightward. Both halves are
 * falsification-round findings (mmnto-ai/totem#2626):
 *
 * - Round 1: bare substring matching mis-bucketed mid-word containments —
 *   `nit` fired inside "defi**nit**ions" (ghcq's stock closing boilerplate,
 *   5 of the 7 real in-org ghcq findings) and "u**nit** test" (every bot),
 *   routing real findings to the NITS bucket. Hence the leading boundary.
 * - Round 2: a TRAILING `\b` broke the lists' deliberate stem prefixes
 *   ('sanitiz', 'escap', 'authori', 'authenticat') and every inflected form
 *   ('leaks', 'race conditions', 'empty catches'). Hence the open trail.
 *
 * The lookbehind uses Unicode letter/number classes rather than `\b` because
 * `_` is a `\w` character — CodeRabbit's `_🟡 Minor_` italic markup must
 * still match — and so non-ASCII letters ("ünit") also count as blocking
 * word-context, closing the ASCII-only containment leak.
 */
function matchesKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text),
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
