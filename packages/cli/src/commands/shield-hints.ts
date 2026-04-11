import * as fs from 'node:fs';
import * as path from 'node:path';

import { log } from '../ui.js';
// totem-context: shield-templates is a pure constants module — static import is correct, dynamic-imports-in-CLI lint rule is a false positive here
import { DISPLAY_TAG } from './shield-templates.js'; // totem-context: pure constants module import

// ─── Annotation regex (ADR-071: totem-context is primary, shield-context is deprecated alias) ─

const CONTEXT_ANNOTATION_RE = /\/\/\s*(?:totem-context|shield-context):\s*(.+)/;
const LEGACY_SHIELD_CONTEXT_RE = /\/\/\s*shield-context:/;

let shieldContextHintsWarned = false;

/** @internal — exposed for testing only */
export function resetShieldContextHintsWarning(): void {
  shieldContextHintsWarned = false;
}

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
          if (!shieldContextHintsWarned && LEGACY_SHIELD_CONTEXT_RE.test(lines[i]!)) {
            shieldContextHintsWarned = true;
            log.warn(
              DISPLAY_TAG,
              'Deprecation: "// shield-context:" is deprecated. Use "// totem-context:" instead. (See ADR-071)',
            );
          }
          annotations.push({ file, line: i + 1, text: match[1]!.trim() });
        }
      }
    } catch (err) {
      // totem-context: String(err) only runs after instanceof Error guard — standard error-to-string fallback
      log.dim(DISPLAY_TAG, `Skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
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

  // Auto-detect: synchronous adapter files that use gh CLI via safeExec (#1058)
  const adapterFiles = changedFiles.filter(
    (f) =>
      f.includes('adapters/') &&
      (f.endsWith('gh-utils.ts') || f.endsWith('github-cli-pr.ts') || f.endsWith('github-cli.ts')),
  );
  if (adapterFiles.length > 0) {
    hints.push(
      `Adapter files in diff: ${adapterFiles.join(', ')}. These use synchronous gh CLI calls via safeExec (child_process.execFileSync). handleGhError returns \`never\`. Do not flag missing \`await\` on these methods.`,
    );
  }

  // Per-file annotations: use pre-computed or extract fresh
  const annotations = precomputedAnnotations ?? extractShieldContextAnnotations(changedFiles, cwd);
  for (const ann of annotations) {
    hints.push(`[${ann.file}] ${ann.text}`);
  }

  return hints;
}
