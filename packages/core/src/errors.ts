/**
 * Totem error class hierarchy.
 *
 * Every Totem error includes:
 * - A clear message with [Totem Error] prefix
 * - A recoveryHint telling the user exactly how to fix it
 * - A code for programmatic handling
 */

export type TotemErrorCode =
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'DATABASE_CORRUPT'
  | 'DATABASE_MISMATCH'
  | 'EMBEDDING_UNAVAILABLE'
  | 'ORCHESTRATOR_UNAVAILABLE'
  | 'COMPILE_FAILED'
  | 'PARSE_FAILED'
  | 'SYNC_FAILED'
  | 'GIT_FAILED'
  | 'NO_LESSONS'
  | 'NO_RULES'
  | 'SHIELD_FAILED'
  | 'LINT_LESSONS_FAILED'
  | 'DRIFT_FAILED'
  | 'TEST_FAILED'
  | 'CHECK_FAILED'
  | 'MCP_ERROR'
  | 'UPGRADE_HASH_NOT_FOUND'
  | 'UPGRADE_HASH_AMBIGUOUS'
  | 'STAGED_READ_FAILED'
  | 'UPGRADE_CLOUD_UNSUPPORTED';

export class TotemError extends Error {
  readonly code: TotemErrorCode;
  readonly recoveryHint: string;

  constructor(code: TotemErrorCode, message: string, recoveryHint: string, cause?: unknown) {
    super(`[Totem Error] ${message}`, { cause });
    this.name = 'TotemError';
    this.code = code;
    this.recoveryHint = recoveryHint;
  }
}

export class TotemConfigError extends TotemError {
  constructor(
    message: string,
    recoveryHint: string,
    code: 'CONFIG_MISSING' | 'CONFIG_INVALID' = 'CONFIG_MISSING',
    cause?: unknown,
  ) {
    super(code, message, recoveryHint, cause);
    this.name = 'TotemConfigError';
  }
}

export class TotemDatabaseError extends TotemError {
  constructor(
    message: string,
    recoveryHint: string,
    code: 'DATABASE_CORRUPT' | 'DATABASE_MISMATCH' = 'DATABASE_CORRUPT',
    cause?: unknown,
  ) {
    super(code, message, recoveryHint, cause);
    this.name = 'TotemDatabaseError';
  }
}

export class TotemCompileError extends TotemError {
  constructor(message: string, recoveryHint: string, cause?: unknown) {
    super('COMPILE_FAILED', message, recoveryHint, cause);
    this.name = 'TotemCompileError';
  }
}

export class TotemParseError extends TotemError {
  constructor(message: string, recoveryHint: string, cause?: unknown) {
    super('PARSE_FAILED', message, recoveryHint, cause);
    this.name = 'TotemParseError';
  }
}

export class TotemOrchestratorError extends TotemError {
  constructor(message: string, recoveryHint: string, cause?: unknown) {
    super('ORCHESTRATOR_UNAVAILABLE', message, recoveryHint, cause);
    this.name = 'TotemOrchestratorError';
  }
}

export class TotemGitError extends TotemError {
  constructor(message: string, recoveryHint: string, cause?: unknown) {
    super('GIT_FAILED', message, recoveryHint, cause);
    this.name = 'TotemGitError';
  }
}

// ─── Utilities ──────────────────────────────────────

/** Extract a human-readable message from an unknown thrown value. */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-throw as TotemParseError, preserving already-wrapped errors.
 * Use in catch blocks where AST engine failures must fail-closed.
 */
export function rethrowAsParseError(label: string, err: unknown, hint: string): never {
  if (err instanceof TotemParseError) throw err;
  throw new TotemParseError(`${label}: ${getErrorMessage(err)}`, hint, err); // totem-ignore — #848: TotemError constructor auto-prepends [Totem Error]
}
