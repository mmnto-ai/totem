// Adversarial corpus: trap-caught for process.cwd replace
// This code SHOULD trigger a violation.
// Rule: $OBJ.replace(process.cwd(), $REPLACEMENT)
// Bug: string.replace(process.cwd(), '') only strips the first occurrence
// and breaks on Windows backslash paths. Use path.relative() instead.

import * as fs from 'fs';

function getRelativePath(fullPath: string): string {
  const rel = fullPath.replace(process.cwd(), '');
  return rel;
}

export { getRelativePath };
