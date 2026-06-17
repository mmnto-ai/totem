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

  const content = await resolveContent(file, fullPath, cwd, options);
  if (content === null) return; // unreadable / readStrategy returned null — skip classification

  const lineNumbers = additions.map((a) => a.lineNumber);

  const classifications = await classifyContent(content, lineNumbers, lang, file, onWarn);
  if (classifications === null) return; // parse failed — skip classification (fail-open)

  // Enrich additions with their AST context
  for (const addition of additions) {
    const ctx = classifications.get(addition.lineNumber);
    if (ctx) {
      addition.astContext = ctx;
    }
  }
}

/**
 * Resolve the file content to classify. When `options.readStrategy` is set
 * (the wind-tunnel parity seam, mmnto-ai/totem#2188), it is the sole source:
 * a `null` return means "skip" (same as unreadable) and a throw propagates
 * (C2 — a missing post-image blob must not silently no-match). When absent,
 * the established staged (`git show :path`) → disk fallback is used.
 *
 * Returns `null` when the file cannot be read and classification should be
 * skipped (fail-open — AST enrichment is advisory, not a hard sensor).
 */
async function resolveContent(
  file: string,
  fullPath: string,
  cwd: string,
  options: AstGateOptions,
): Promise<string | null> {
  if (options.readStrategy) {
    const injected = await options.readStrategy(file);
    if (injected === null) {
      options.onWarn?.(`AST gate: readStrategy returned null for ${file}, skipping classification`);
    }
    return injected;
  }

  // totem-context: intentional fallback — git show :path is the preferred staged read; a non-staged file falls through to the disk read below (advisory AST enrichment, never a hard sensor).
  try {
    // Prefer staged content (git show :path) over disk file to match the diff being evaluated.
    const { safeExec } = await import('./sys/exec.js');
    return safeExec('git', ['show', `:${file}`], { cwd });
    // totem-context: intentional fallback — staged read missing → disk read below.
  } catch (gitErr) {
    void gitErr;
  }

  // totem-context: intentional fail-open — an unreadable file degrades to skip-classification (advisory AST enrichment, never a hard sensor).
  try {
    return fs.readFileSync(fullPath, 'utf-8');
    // totem-context: intentional fail-open — unreadable file → skip classification.
  } catch (diskErr) {
    void diskErr;
    options.onWarn?.(`AST gate: cannot read ${file}, skipping classification`);
    return null;
  }
}

/**
 * Classify the given lines of `content`, returning the per-line AST context
 * map. Returns `null` when the parse fails so the caller skips classification
 * (fail-open — AST enrichment is advisory, not a hard sensor).
 */
async function classifyContent(
  content: string,
  lineNumbers: number[],
  lang: Parameters<typeof classifyLines>[2],
  file: string,
  onWarn?: (msg: string) => void,
): Promise<Map<number, AstContext> | null> {
  // totem-context: intentional fail-open — an unparseable file degrades to skip-classification (advisory AST enrichment, never a hard sensor).
  try {
    return await classifyLines(content, lineNumbers, lang);
    // totem-context: intentional fail-open — unparseable file → skip classification.
  } catch (parseErr) {
    void parseErr;
    onWarn?.(`AST gate: parse failed for ${file}, skipping classification`);
    return null;
  }
}
