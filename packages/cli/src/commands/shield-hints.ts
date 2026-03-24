import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Auto-detect contextual hints from the diff and changed files.
 * These are injected into the shield prompt to reduce false positives.
 */
export function extractShieldHints(diff: string, changedFiles: string[], cwd: string): string[] {
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

  // Per-file annotations: read // shield-context: comments from changed files on disk
  for (const file of changedFiles) {
    try {
      const fullPath = path.join(cwd, file);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^\s*\/\/\s*shield-context:\s*(.+)/);
        if (match) {
          hints.push(`[${file}] ${match[1].trim()}`);
        }
      }
    } catch {
      // File unreadable — skip
    }
  }

  return hints;
}
