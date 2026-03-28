import * as crypto from 'node:crypto';

import type { ShieldFinding } from '../commands/shield-templates.js';
import type {
  ExemptionLocal,
  ExemptionPattern,
  ExemptionShared,
  SharedExemptionEntry,
} from './exemption-schema.js';
import { PROMOTION_THRESHOLD } from './exemption-schema.js';

// ─── Stopwords ──────────────────────────────────────────

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'can',
  'could',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'or',
  'and',
  'but',
  'not',
  'this',
  'that',
  'it',
  'its',
  'no',
  'if',
  'so',
  'up',
  'out',
  'about',
]);

function extractKeywords(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .sort();
}

export function computePatternId(message: string): string {
  const keywords = extractKeywords(message);
  const joined = keywords.join(':');
  const hash = crypto.createHash('sha256').update(joined).digest('hex');
  return `shield:${hash}`;
}

export function recordFalsePositive(
  local: ExemptionLocal,
  patternId: string,
  source: 'shield' | 'bot',
  message: string,
): { updatedLocal: ExemptionLocal; promoted: boolean } {
  const existing: ExemptionPattern = local.patterns[patternId] ?? {
    count: 0,
    sources: [],
    lastSeenAt: new Date().toISOString(),
    sampleMessages: [],
  };

  const count = existing.count + 1;
  const sources = existing.sources.includes(source)
    ? existing.sources
    : [...existing.sources, source];
  const sampleMessages =
    existing.sampleMessages.length < 3
      ? [...existing.sampleMessages, message]
      : existing.sampleMessages;

  const updated: ExemptionPattern = {
    count,
    sources,
    lastSeenAt: new Date().toISOString(),
    sampleMessages,
  };

  const updatedLocal: ExemptionLocal = {
    patterns: { ...local.patterns, [patternId]: updated },
  };

  return { updatedLocal, promoted: count === PROMOTION_THRESHOLD };
}

export function promoteToShared(
  shared: ExemptionShared,
  patternId: string,
  localPattern: ExemptionPattern,
): ExemptionShared {
  if (shared.exemptions.some((e) => e.patternId === patternId)) {
    return shared;
  }

  const keywords = localPattern.sampleMessages[0]
    ? extractKeywords(localPattern.sampleMessages[0]).slice(0, 5).join(' ')
    : '';
  const label = keywords || patternId;

  const entry: SharedExemptionEntry = {
    patternId,
    label,
    reason: `Auto-promoted after ${localPattern.count} false positives`,
    promotedAt: new Date().toISOString(),
    promotedBy: 'auto',
    sampleMessages: localPattern.sampleMessages,
  };

  return {
    ...shared,
    exemptions: [...shared.exemptions, entry],
  };
}

export function filterExemptedFindings(
  findings: ShieldFinding[],
  shared: ExemptionShared,
): { filtered: ShieldFinding[]; exempted: ShieldFinding[] } {
  const autoExemptedIds = new Set(
    shared.exemptions.filter((e) => !e.patternId.startsWith('manual:')).map((e) => e.patternId),
  );
  const manualLabels = shared.exemptions
    .filter((e) => e.patternId.startsWith('manual:'))
    .map((e) => e.label.toLowerCase());

  const filtered: ShieldFinding[] = [];
  const exempted: ShieldFinding[] = [];

  for (const finding of findings) {
    const pid = computePatternId(finding.message);
    const msgLower = finding.message.toLowerCase();
    const matchesAuto = autoExemptedIds.has(pid);
    const matchesManual = manualLabels.some((label) => msgLower.includes(label));

    if (matchesAuto || matchesManual) {
      exempted.push({ ...finding, severity: 'INFO' });
    } else {
      filtered.push(finding);
    }
  }

  return { filtered, exempted };
}

export function isExempted(patternId: string, exemptions: ExemptionShared): boolean {
  return exemptions.exemptions.some((e) => e.patternId === patternId);
}

export function addManualSuppression(
  shared: ExemptionShared,
  label: string,
  reason: string,
): ExemptionShared {
  const patternId = `manual:${label}`;

  if (shared.exemptions.some((e) => e.patternId === patternId)) {
    return shared;
  }

  const entry: SharedExemptionEntry = {
    patternId,
    label,
    reason,
    promotedAt: new Date().toISOString(),
    promotedBy: 'manual',
    sampleMessages: [],
  };

  return {
    ...shared,
    exemptions: [...shared.exemptions, entry],
  };
}
