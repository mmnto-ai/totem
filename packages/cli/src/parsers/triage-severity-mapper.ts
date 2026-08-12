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
 * Category keyword matching is deliberately ASYMMETRIC by bucket
 * (mmnto-ai/totem#2626, three falsification rounds):
 *
 * - SECURITY / ARCHITECTURE / CONVENTION keep plain substring matching — the
 *   long-standing behavior. Their lists carry deliberate stem prefixes
 *   ('sanitiz', 'authenticat') whose real hits are letter-joined on EITHER
 *   side ("unsanitized", "unauthorized", "sanitized"), and over-matching
 *   into a higher-priority bucket cuts the safe way: a finding surfaces too
 *   prominently instead of being buried.
 * - NIT requires the keyword to START outside word context. Innocent
 *   containments — `nit` inside "defi**nit**ions" (ghcq's stock closing
 *   boilerplate, 5 of the 7 real in-org ghcq findings), "u**nit** test",
 *   "is_minor_bump" — demoted real findings into the lowest bucket, the
 *   unsafe direction. Blocked word-context is letters, numbers, combining
 *   marks (NFD text), and `_` (snake_case identifiers); real CodeRabbit
 *   severity markup keeps a space or emoji before the token (`_🟡 Minor_` —
 *   see the `\s*` in parse-nits.ts's severity regex), so it still matches.
 *   The trail stays open so inflections keep matching ('nits', 'typos').
 *
 * Net effect vs the pre-#2626 behavior: the NITS bucket only narrows
 * (leading-restriction only ⇒ boundary matches ⊆ substring matches, modulo
 * the `u` flag's Unicode simple case folding on exotic codepoints like
 * U+017F LONG S — practically unreachable in bot prose) and the other three
 * buckets are byte-for-byte unchanged.
 */
function matchesNitKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) =>
    new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(
      text,
    ),
  );
}

export function mapToTriageCategory(finding: NormalizedBotFinding): TriageCategory {
  // Only search the body for keywords — NOT severity, which would cause
  // 'minor' severity to match NIT_KEYWORDS and misbucket
  const text = finding.body.toLowerCase();

  // Check in priority order — security first
  if (SECURITY_KEYWORDS.some((kw) => text.includes(kw))) return 'security';
  if (ARCHITECTURE_KEYWORDS.some((kw) => text.includes(kw))) return 'architecture';
  if (CONVENTION_KEYWORDS.some((kw) => text.includes(kw))) return 'convention';
  if (matchesNitKeyword(text, NIT_KEYWORDS)) return 'nit';

  // Fall back to bot-assigned severity
  if (finding.severity === 'critical' || finding.severity === 'high') return 'security';
  if (finding.severity === 'major' || finding.severity === 'medium') return 'architecture';
  if (finding.severity === 'minor' || finding.severity === 'low') return 'convention';

  return 'architecture'; // default to architecture (better safe than sorry)
}
