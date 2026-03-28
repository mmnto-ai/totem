// Adversarial corpus: trap-bypassed for process.cwd replace
// This code SHOULD NOT trigger a violation.
// Uses path.relative() which correctly handles cross-platform paths.

import * as path from 'path';

function getRelativePath(fullPath: string): string {
  const rel = path.relative(process.cwd(), fullPath);
  return rel;
}

export { getRelativePath };
