// ─── Shared Helper Registry (#1015) ─────────────────────
// Static, deterministic registry of shared helpers for prompt injection.
// No LLM, no index queries — just a list of utilities agents should know about.

export interface SharedHelper {
  name: string;
  module: string; // e.g., '@mmnto/totem' or 'core/src/sys/exec.ts'
  signature: string; // e.g., 'safeExec(cmd: string, args: string[]): string'
  description: string; // one-liner
  useInstead: string; // what NOT to do, e.g., 'child_process.execSync'
}

export function getSharedHelpers(): SharedHelper[] {
  return [
    {
      name: 'safeExec',
      module: '@mmnto/totem',
      signature: 'safeExec(command: string, args?: string[], options?: SafeExecOptions): string',
      description: 'Cross-platform shell execution with error handling and timeout support',
      useInstead: 'child_process.execSync or child_process.spawnSync',
    },
    {
      name: 'readJsonSafe',
      module: '@mmnto/totem',
      signature: 'readJsonSafe<T>(filePath: string, schema?: ZodSchema<T>): T',
      description:
        'Read and validate a JSON file with optional Zod schema, throws TotemParseError on missing/invalid',
      useInstead: 'JSON.parse(fs.readFileSync(...))',
    },
    {
      name: 'extractChangedFiles',
      module: '@mmnto/totem',
      signature: 'extractChangedFiles(diff: string): string[]',
      description: 'Parse file paths from a unified diff string',
      useInstead: 'manual diff parsing with regex',
    },
    {
      name: 'getGitDiff',
      module: '@mmnto/totem',
      signature: "getGitDiff(mode: 'staged' | 'all', cwd: string): string",
      description: 'Get git diff (staged or all) for the current repo',
      useInstead: 'safeExec("git", ["diff", ...])',
    },
    {
      name: 'getGitBranch',
      module: '@mmnto/totem',
      signature: 'getGitBranch(cwd: string): string',
      description: 'Get the current git branch name',
      useInstead: 'safeExec("git", ["branch", "--show-current"])',
    },
    {
      name: 'resolveGitRoot',
      module: '@mmnto/totem',
      signature: 'resolveGitRoot(cwd: string): string | null',
      description: 'Find the root directory of the git repository, or null if not in a repo',
      useInstead: 'safeExec("git", ["rev-parse", "--show-toplevel"])',
    },
    {
      name: 'maskSecrets',
      module: '@mmnto/totem',
      signature: 'maskSecrets(text: string, customSecrets?: CustomSecret[]): string',
      description: 'Redact secrets from a string before sending to external APIs (DLP)',
      useInstead: 'manual regex replacement of secrets',
    },
    {
      name: 'getDefaultBranch',
      module: '@mmnto/totem',
      signature: 'getDefaultBranch(cwd: string): string',
      description: 'Detect the default branch (main/master) from git remote',
      useInstead: 'hardcoding "main" or "master"',
    },
  ];
}

/**
 * Format shared helpers as a markdown section for prompt injection.
 */
export function formatSharedHelpers(helpers: SharedHelper[]): string {
  if (helpers.length === 0) return '';
  const lines = ['=== SHARED HELPERS (use these instead of reimplementing) ===', ''];
  for (const h of helpers) {
    lines.push(`**${h.name}** — ${h.description}`);
    lines.push(`  Import: \`import { ${h.name} } from '${h.module}';\``);
    lines.push(`  Signature: \`${h.signature}\``);
    lines.push(`  Instead of: ${h.useInstead}`);
    lines.push('');
  }
  return lines.join('\n');
}
