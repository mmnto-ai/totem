import type { DiffAddition } from './compiler-schema.js';

// ─── Diff parsing ───────────────────────────────────

/** The single-character C escapes git's path quoting writes, by the letter after the backslash. */
const C_ESCAPES: Readonly<Record<string, number>> = Object.freeze({
  '\\': 0x5c,
  '"': 0x22,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
});

/**
 * Decode a path the way git wrote it in a `+++`/`---` diff header
 * (mmnto-ai/totem#3048, read 2). Under `core.quotepath` (on by default) git
 * C-quotes a path carrying a byte outside printable ASCII — `src/café.ts`
 * arrives as `"src/caf\303\251.ts"` — and always quotes one carrying a double
 * quote, a backslash or a control character, writing each such byte as a
 * three-digit octal escape or a one-letter C escape. A path with a space is
 * written bare and followed by a tab so its end is unambiguous.
 *
 * A quoted header is unquoted and its escapes decoded to UTF-8; a bare header
 * has a trailing tab removed. A path that was never quoted or tabbed comes back
 * byte-identical. Without this a quoted path reached `git show` and the file
 * system as the literal escape text, so the file was never found.
 */
export function decodeGitHeaderPath(headerPath: string): string {
  const quoted = headerPath.length >= 2 && headerPath.startsWith('"') && headerPath.endsWith('"');
  if (!quoted) return headerPath.replace(/\t$/, '');
  const chars = Array.from(headerPath.slice(1, -1));
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf-8'));
      continue;
    }
    const octal = chars.slice(i + 1, i + 4).join('');
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    const next = chars[i + 1];
    if (next !== undefined && next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next]!);
      i += 1;
      continue;
    }
    bytes.push(0x5c); // a backslash git did not write an escape for: kept as is
  }
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * Extract added lines from a unified diff.
 * Returns only lines that start with `+` (excluding `+++` file headers).
 * Tracks the preceding line content (context or added) for suppression support.
 */
export function extractAddedLines(diff: string): DiffAddition[] {
  const additions: DiffAddition[] = [];
  let currentFile = '';
  let lineNum = 0;
  let prevLineContent: string | null = null;
  let insideHunk = false;

  for (const rawLine of diff.split('\n')) {
    // New file block — reset hunk state
    if (rawLine.startsWith('diff ')) {
      insideHunk = false;
      continue;
    }

    // Track current file from diff headers — only BEFORE the first hunk.
    // Inside a hunk, a line starting with +++ is an added line whose
    // content happens to start with ++ (e.g., template literal test fixtures
    // containing embedded diff headers like "+++ b/some-file.ts").
    if (!insideHunk && rawLine.startsWith('+++')) {
      // Decode the path as git wrote it: C-quoting for non-ASCII and special
      // bytes, a trailing tab after a path with a space (decodeGitHeaderPath).
      const pathPart = decodeGitHeaderPath(rawLine.slice(4)); // strip "+++ "
      // Strip the "b/" prefix git uses for the destination file
      currentFile = pathPart.startsWith('b/') ? pathPart.slice(2) : pathPart;
      prevLineContent = null;
      continue;
    }

    // Parse hunk header for line numbers: @@ -X,Y +Z,W @@
    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      insideHunk = true;
      lineNum = parseInt(hunkMatch[1]!, 10) - 1; // will be incremented on first line
      prevLineContent = null;
      continue;
    }

    // Skip diff metadata lines
    if (rawLine.startsWith('---') || rawLine.startsWith('index ')) {
      continue;
    }

    // Count lines for position tracking
    if (rawLine.startsWith('+')) {
      lineNum++;
      const lineContent = rawLine.slice(1); // strip the leading +
      additions.push({
        file: currentFile,
        line: lineContent,
        lineNumber: lineNum,
        precedingLine: prevLineContent,
      });
      prevLineContent = lineContent;
    } else if (rawLine.startsWith('-')) {
      // Deleted line — NOT in new file, don't update prevLineContent or lineNum
    } else if (rawLine.startsWith(' ')) {
      // Context line — in new file
      lineNum++;
      prevLineContent = rawLine.slice(1);
    }
    // Ignore other lines (e.g., '\ No newline at end of file')
  }

  return additions;
}
