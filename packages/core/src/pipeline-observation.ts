/**
 * Pipeline 5 — Observation-based auto-capture.
 *
 * Converts shield findings into lint rules by extracting the offending
 * source line, converting it to a regex pattern, and wrapping it in a
 * CompiledRule. A deduplication pass merges rules with identical patterns.
 */

import { createHash } from 'node:crypto';
import { extname } from 'node:path';

import type { CompiledRule } from './compiler-schema.js';
import { codeToPattern } from './regex-utils.js';

// ─── Input type ────────────────────────────────────

/** Describes a single shield observation that should be turned into a rule. */
export interface ObservationInput {
  /** File path where the finding was reported. */
  file: string;
  /** 1-based line number of the finding. */
  line: number;
  /** Shield finding message. */
  message: string;
  /** Full content of the file. */
  fileContent: string;
}

// ─── Generator ─────────────────────────────────────

/**
 * Generate a CompiledRule from a shield observation.
 *
 * Returns `null` when the target line is out of range, empty, or produces
 * an empty pattern.
 *
 * **Invariant (ADR-058):** severity is always `'warning'`, never `'error'`.
 */
export function generateObservationRule(input: ObservationInput): CompiledRule | null {
  const lines = input.fileContent.split('\n');

  // 1-based → 0-based
  const idx = input.line - 1;
  if (idx < 0 || idx >= lines.length) {
    return null;
  }

  const sourceLine = lines[idx];

  // Reject empty / whitespace-only lines
  if (!sourceLine || sourceLine.trim().length === 0) {
    return null;
  }

  const pattern = codeToPattern(sourceLine);
  if (pattern === '') {
    return null;
  }

  const hash = createHash('sha256').update(`pipeline-5:${pattern}`).digest('hex').slice(0, 16);

  const ext = extname(input.file); // e.g. ".ts"
  const fileGlobs = ext ? [`**/*${ext}`] : undefined;

  const now = new Date().toISOString();

  return {
    lessonHash: hash,
    lessonHeading: 'Pipeline 5: observation from shield',
    pattern,
    message: input.message,
    engine: 'regex',
    severity: 'warning',
    fileGlobs,
    compiledAt: now,
    createdAt: now,
  };
}

// ─── Deduplicator ──────────────────────────────────

/**
 * Merge rules that share the same `lessonHash` (i.e., identical pattern).
 *
 * For duplicates the unique messages are joined with ` | `.
 */
export function deduplicateObservations(rules: CompiledRule[]): CompiledRule[] {
  const map = new Map<string, CompiledRule>();
  const messageMap = new Map<string, string[]>();

  for (const rule of rules) {
    const existing = map.get(rule.lessonHash);
    if (!existing) {
      map.set(rule.lessonHash, { ...rule });
      messageMap.set(rule.lessonHash, [rule.message]);
    } else {
      const messages = messageMap.get(rule.lessonHash)!;
      if (!messages.includes(rule.message)) {
        messages.push(rule.message);
      }
    }
  }

  const result: CompiledRule[] = [];
  for (const [hash, rule] of map) {
    const messages = messageMap.get(hash)!;
    result.push({ ...rule, message: messages.join(' | ') });
  }

  return result;
}
