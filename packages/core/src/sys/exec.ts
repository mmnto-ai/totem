import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export interface SafeExecOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: NodeJS.ProcessEnv;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Override the default 10MB maxBuffer limit */
  maxBuffer?: number;
  /** Automatically trim the returned string. Defaults to true. */
  trim?: boolean;
  /** Override stdio (defaults to 'pipe' for safety — never 'inherit' in MCP context) */
  stdio?: ExecFileSyncOptions['stdio'];
  /** Pass input to stdin */
  input?: string;
}

/**
 * Execute a command synchronously with cross-platform shell protections.
 *
 * - Windows: automatically sets `shell: true` to resolve .cmd/.bat executables
 * - UTF-8 encoding enforced (always returns string, never Buffer)
 * - 10MB maxBuffer default (prevents ENOBUFS on large git diffs)
 * - Auto-trims output (disable with `trim: false`)
 * - Error cause chains preserved (ES2022)
 */
export function safeExec(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {},
): string {
  const { trim: shouldTrim = true, ...rest } = options;

  try {
    const result = execFileSync(command, args, {
      encoding: 'utf-8',
      shell: IS_WIN,
      maxBuffer: rest.maxBuffer ?? DEFAULT_MAX_BUFFER,
      stdio: rest.stdio ?? 'pipe',
      cwd: rest.cwd,
      env: rest.env,
      timeout: rest.timeout,
      input: rest.input,
    });

    return shouldTrim ? result.trim() : result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Extract stderr from child process error if available
    const stderr = (err as { stderr?: Buffer | string })?.stderr;
    const stderrStr = stderr instanceof Buffer ? stderr.toString('utf-8') : stderr;
    const detail = stderrStr ? `\n${stderrStr.toString().trim()}` : '';

    throw new Error(
      `Command failed: ${command} ${args.join(' ')}${detail ? detail : `: ${message}`}`,
      { cause: err },
    );
  }
}
