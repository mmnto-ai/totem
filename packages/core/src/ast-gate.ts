import * as fs from 'node:fs';
import * as path from 'node:path';

import { classifyLines, extensionToLanguage } from './ast-classifier.js';
import type { AstContext, DiffAddition } from './compiler.js';

// ─── Types ──────────────────────────────────────────

export interface AstGateOptions {
  /** Working directory to resolve file paths against */
  cwd?: string;
  /** Optional callback for non-fatal warnings (e.g., file not readable) */
  onWarn?: (msg: string) => void;
  /**
   * Optional content injection seam (C1 — wind-tunnel parity).
   * When provided, classifyFile uses this instead of git-show / disk reads,
   * so regex astContext classification sees the same post-image content as
   * the AST engine. Returning null skips classification for that file (same
   * as an unreadable file). Throwing propagates — callers must not silently
   * swallow (C2: missing blob is corpus shrinkage, not a clean no-match).
   */
  readStrategy?: (file: string) => Promise<string | null>;
}

// ─── Public API ─────────────────────────────────────

/**
 * Enrich diff additions with AST context by parsing the actual files.
 *
 * Groups additions by file, reads each file from disk, runs Tree-sitter
 * classification, and sets `astContext` on each addition.
 *
 * Additions for unsupported file types or unreadable files are left
 * with `astContext: undefined` (fail-open — treated as code by the shield).
 */
export async function enrichWithAstContext(
  additions: DiffAddition[],
  options: AstGateOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Group additions by file
  const byFile = new Map<string, DiffAddition[]>();
  for (const a of additions) {
    const existing = byFile.get(a.file);
    if (existing) {
      existing.push(a);
    } else {
      byFile.set(a.file, [a]);
    }
  }

  // Process each file
  const promises: Promise<void>[] = [];

  for (const [file, fileAdditions] of byFile) {
    const ext = path.extname(file);
    const lang = extensionToLanguage(ext);
    if (!lang) continue; // Unsupported language — leave as undefined (fail-open)

    promises.push(classifyFile(file, fileAdditions, lang, cwd, options));
  }

  await Promise.all(promises);
}

async function classifyFile(
  file: string,
  additions: DiffAddition[],
  lang: Parameters<typeof classifyLines>[2],
  cwd: string,
  options: AstGateOptions,
): Promise<void> {
  const onWarn = options.onWarn;
  const fullPath = path.resolve(cwd, file);

  // Path containment: skip files that escape the working directory
  const resolvedCwd = path.resolve(cwd) + path.sep;
  if (!fullPath.startsWith(resolvedCwd)) {
    onWarn?.(`AST gate: ${file} escapes project root, skipping`);
    return;
  }

  let content: string;
  if (options.readStrategy) {
    // Injection seam: callers supply post-image content for parity with the
    // AST engine. null → skip (same as unreadable). Throws propagate (C2).
    const injected = await options.readStrategy(file);
    if (injected === null) {
      onWarn?.(`AST gate: readStrategy returned null for ${file}, skipping classification`);
      return;
    }
    content = injected;
  } else {
    try {
      // Prefer staged content (git show :path) over disk file to match the diff being evaluated.
      // Falls back to disk if git is unavailable or file isn't staged.
      const { safeExec } = await import('./sys/exec.js');
      content = safeExec('git', ['show', `:${file}`], { cwd });
    } catch {
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        onWarn?.(`AST gate: cannot read ${file}, skipping classification`);
        return;
      }
    }
  }

  const lineNumbers = additions.map((a) => a.lineNumber);

  let classifications: Map<number, AstContext>;
  try {
    classifications = await classifyLines(content, lineNumbers, lang);
  } catch {
    onWarn?.(`AST gate: parse failed for ${file}, skipping classification`);
    return;
  }

  // Enrich additions with their AST context
  for (const addition of additions) {
    const ctx = classifications.get(addition.lineNumber);
    if (ctx) {
      addition.astContext = ctx;
    }
  }
}
