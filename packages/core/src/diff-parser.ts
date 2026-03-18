import type { DiffAddition } from './compiler-schema.js';

// ─── Diff parsing ───────────────────────────────────

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
      let pathPart = rawLine.slice(4); // strip "+++ "
      // Strip surrounding quotes (git adds them for paths with spaces)
      if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
        pathPart = pathPart.slice(1, -1);
      }
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
