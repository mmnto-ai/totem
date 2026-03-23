import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Detect the package manager for a project by checking lock files.
 * Returns the command name: 'pnpm', 'yarn', or 'npx'.
 */
export function detectPackageManager(projectRoot: string): 'pnpm' | 'yarn' | 'npx' {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npx';
}
