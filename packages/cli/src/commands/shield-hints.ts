import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Annotation regex (ADR-071: match both shield-context and totem-context) ─

const CONTEXT_ANNOTATION_RE = /\/\/\s*(?:shield-context|totem-context):\s*(.+)/;

// ─── Structured annotation type ─────────────────────

export interface ShieldContextAnnotation {
  /** Relative file path within the project */
  file: string;
  /** 1-based line number where the annotation was found */
  line: number;
  /** The annotation text (trimmed) */
  text: string;
}

/**
 * Extract structured shield/totem-context annotations from changed files.
 * Returns file, line number, and text for each annotation found.
 * Used by the Trap Ledger to record override events.
 */
export function extractShieldContextAnnotations(
  changedFiles: string[],
  cwd: string,
): ShieldContextAnnotation[] {
  const annotations: ShieldContextAnnotation[] = [];
  for (const file of changedFiles) {
    try {
      const fullPath = path.join(cwd, file);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i]!.match(CONTEXT_ANNOTATION_RE);
        if (match) {
          annotations.push({ file, line: i + 1, text: match[1]!.trim() });
        }
      }
    } catch {
      // File unreadable — skip
    }
  }
  return annotations;
}

/**
 * Auto-detect contextual hints from the diff and changed files.
 * Accepts optional pre-computed annotations to avoid double file reads.
 */
export function extractShieldHints(
  diff: string,
  changedFiles: string[],
  cwd: string,
  precomputedAnnotations?: ShieldContextAnnotation[],
): string[] {
  const hints: string[] = [];

  // Auto-detect: DLP redaction artifacts
  if (diff.includes('[REDACTED]') || diff.includes('*redacted*')) {
    hints.push(
      'DLP redacted secret-like strings in test fixtures. Patterns showing [REDACTED] are artifacts — the actual test file uses valid regex patterns. Do NOT flag these as broken tests.',
    );
  }

  // Auto-detect: test files present in diff
  const hasTests = changedFiles.some((f) => /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(f));
  if (hasTests) {
    hints.push(
      'This diff includes test files. Do not flag missing test coverage for code that has co-located test updates in the same diff.',
    );
  }

  // Auto-detect: new files in diff
  const newFileCount = (diff.match(/^diff --git a\/.*\nnew file mode/gm) || []).length;
  if (newFileCount > 0) {
    hints.push(
      `This diff contains ${newFileCount} new file(s). These may not appear in all shield views — check for their presence before flagging missing implementations.`,
    );
  }

  // Per-file annotations: use pre-computed or extract fresh
  const annotations = precomputedAnnotations ?? extractShieldContextAnnotations(changedFiles, cwd);
  for (const ann of annotations) {
    hints.push(`[${ann.file}] ${ann.text}`);
  }

  return hints;
}
