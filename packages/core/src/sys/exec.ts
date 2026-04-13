import { sync as spawnSync } from 'cross-spawn';

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
  /** Pass input to stdin */
  input?: string;
}

/**
 * Execute a command synchronously with cross-platform shell protections.
 *
 * Uses `cross-spawn` instead of Node's native `child_process.execFileSync`
 * to avoid the `shell: IS_WIN` argument-escaping vulnerability that
 * previously let shell metacharacters (like `&`, `|`, `>`, `"`) in
 * argument values be interpreted by cmd.exe on Windows. `cross-spawn`
 * handles Windows `.cmd`/`.bat` shim resolution internally without
 * enabling `shell: true` at the Node layer, so `git.cmd`, `npm.cmd`,
 * and other shims still resolve while shell metacharacters in argument
 * values pass through verbatim (mmnto/totem#1329).
 *
 * Behavioral guarantees preserved from the previous implementation:
 * - Synchronous API, always returns a string (never a Buffer).
 * - UTF-8 encoding enforced on stdout.
 * - 10MB default `maxBuffer` (prevents ENOBUFS on large git diffs).
 * - Auto-trims output (disable with `trim: false`).
 * - Throws on non-zero exit, ENOENT, signal termination, or internal
 *   spawn error. The thrown Error preserves `.cause` for chain walking.
 * - New (strictly additive): the thrown Error exposes optional
 *   `.status`, `.stdout`, and `.stderr` fields matching `cross-spawn`'s
 *   richer return shape. Callers that only read `.message` and `.cause`
 *   continue to work unchanged.
 */
export function safeExec(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {},
): string {
  const { trim: shouldTrim = true, ...rest } = options;

  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    maxBuffer: rest.maxBuffer ?? DEFAULT_MAX_BUFFER,
    stdio: 'pipe',
    cwd: rest.cwd,
    env: rest.env,
    timeout: rest.timeout,
    input: rest.input,
  });

  // cross-spawn surfaces internal spawn failures (ENOENT, permission
  // denied, ENOBUFS, etc.) via result.error rather than throwing.
  // Reserialize into the historical throw shape so callers do not have
  // to learn a new error path.
  if (result.error) {
    throw wrapSpawnError(command, args, result);
  }

  // cross-spawn does NOT throw on non-zero exit. Reimplement the
  // execFileSync throw contract here so existing catch blocks continue
  // to see the same behavior.
  if (result.status !== 0 || result.signal !== null) {
    throw wrapSpawnError(command, args, result);
  }

  const output = typeof result.stdout === 'string' ? result.stdout : '';
  return shouldTrim ? output.trim() : output;
}

/**
 * Error shape extension. Adds optional `.status`, `.signal`, `.stdout`,
 * and `.stderr` fields to the thrown Error object. Callers that only
 * read `.message` and `.cause` (the pre-mmnto/totem#1329 contract)
 * continue to work. Callers that want typed access to the extension
 * fields can narrow via `err as Error & SafeExecErrorFields`.
 *
 * Exported so downstream packages can type-narrow without falling back
 * to `any`. The fields match the raw `SpawnSyncReturns` shape that
 * `cross-spawn.sync` returns, so `.stdout` and `.stderr` preserve any
 * trailing whitespace from the subprocess. Message formatting uses
 * trimmed copies internally, but the fields on the error object are
 * raw.
 */
export interface SafeExecErrorFields {
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

type SpawnResult = ReturnType<typeof spawnSync>;

function wrapSpawnError(command: string, args: string[], result: SpawnResult): Error {
  // Raw stdout/stderr preserve trailing whitespace and are assigned to
  // the thrown Error's `.stdout` / `.stderr` fields so callers see the
  // unmodified subprocess output. Message formatting uses trimmed
  // copies to avoid dumping trailing newlines into user-facing error
  // text.
  const rawStdout = bufferOrStringToString(result.stdout);
  const rawStderr = bufferOrStringToString(result.stderr);
  const trimmedStderr = rawStderr.trim();
  const status = result.status;
  const signal = result.signal;

  // mmnto/totem#1357: cause message no longer inlined. Callers use
  // describeSafeExecError() to unroll the chain when needed.
  let detail: string;
  if (trimmedStderr.length > 0) {
    detail = `\n${trimmedStderr}`;
  } else if (result.error) {
    detail = ': spawn failed';
  } else if (signal) {
    detail = `: killed by ${signal}`;
  } else {
    detail = status !== null ? `: exited with code ${status}` : ': exited with unknown status';
  }

  // Always attach a `.cause` for chain walking. When the underlying
  // issue is a clean non-zero exit (no spawn-level error), synthesize
  // a minimal Error so the legacy `expect(err.cause).toBeDefined()`
  // contract still holds. Existing callers that walk the cause chain
  // get a meaningful node to inspect either way.
  const cause: Error =
    result.error ??
    new Error(
      signal !== null
        ? `Process killed by signal ${signal}`
        : `Process exited with status ${status ?? 'unknown'}`,
    );

  // Build the command line as an array join so the no-args case
  // (`safeExec('git')`) does not produce a double-space/colon-adjacency
  // regression like `Command failed: git : ...`. The array form
  // collapses to `Command failed: git` when args is empty, and to
  // `Command failed: git log --oneline` when args are provided. Detail
  // is concatenated separately because it already begins with its own
  // delimiter (newline or colon-space).
  //
  // Deliberately NO `[Totem Error]` prefix: safeExec is an internal
  // helper, not a user-facing error source. Downstream wrappers such
  // as `handleGhError` in packages/cli/src/adapters/gh-utils.ts use
  // `err.message.includes('[Totem Error]')` as a sentinel to detect
  // already-wrapped errors and re-throw them as-is. Adding the prefix
  // here would short-circuit the context wrapping those callers
  // provide, and users would lose operation-level context like
  // "Failed to fetch open PRs". A follow-up ticket (mmnto/totem#1355)
  // tracks tightening the "Standardize exception messages" lint rule
  // so it does not fire on internal-wrapper Error constructions.
  const commandLine = ['Command failed:', command, ...args].join(' ');
  const wrapped = new Error(commandLine + detail, {
    cause,
  }) as Error & SafeExecErrorFields;

  wrapped.status = status;
  wrapped.signal = signal;
  wrapped.stdout = rawStdout;
  wrapped.stderr = rawStderr;

  return wrapped;
}

function bufferOrStringToString(value: string | Buffer | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value.toString('utf-8');
}

/**
 * Build a human-readable description from a safeExec error, unrolling
 * the cause chain so callers don't need to walk it manually.
 *
 * Deduplicates: if the cause message is already embedded in the wrapper
 * (the pre-migration concat behavior), it is not appended again.
 */
export function describeSafeExecError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const wrapperMsg = err.message;
  if (!(err.cause instanceof Error)) return wrapperMsg;
  const causeMsg = err.cause.message;
  // Deduplicate: if wrapper already contains the cause (pre-migration),
  // don't double-print.
  if (wrapperMsg.includes(causeMsg)) return wrapperMsg;
  return `${wrapperMsg} (${causeMsg})`;
}
