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
  | 'NO_LESSONS_DIR'
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
  | 'UPGRADE_CLOUD_UNSUPPORTED'
  | 'STALE_MANIFEST'
  | 'FLAG_CONFLICT'
  | 'HOOKS_LOAD_FAILED'
  | 'SESSION_ID_WRITE_FAILED'
  | 'SESSION_ID_READ_FAILED'
  | 'ATTRIBUTION_SENSE_LEDGER_READ_FAILED'
  | 'BADGE_VERIFICATION_FAILED'
  | 'CLAIM_DISCIPLINE_FAILED'
  | 'GATE_INVALID'
  | 'PARITY_DRIFT_DETECTED'
  | 'MAIL_SEND_FAILED'
  | 'PR_MERGE_FAILED'
  | 'BASH_RESOLUTION_FAILED'
  /** Query-before-derive correlation contract breach (mmnto-ai/totem#2510). */
  | 'QBD_CORRELATION_CONTRACT'
  /** Eject's loud backstop: every attempted cleanup mutation failed (mmnto-ai/totem#2620). */
  | 'EJECT_FAILED'
  /** Selection-manifest schema breach — an emitter programming error (mmnto-ai/totem#2468). */
  | 'SELECTION_MANIFEST_CONTRACT'
  /** A leg deposit already exists for this read sha and `--replace` was not passed (mmnto-ai/totem#2698). */
  | 'LEG_DEPOSIT_EXISTS'
  /** A mail reader verb's start resolves to no repository or to a linked worktree — refused before any read or write; exit 2 at the CLI (mmnto-ai/totem#2946, mmnto-ai/totem#2968). */
  | 'REPO_ROOT_REFUSED'
  /** A reader opened a vector store that only a rebuild can repair; the sync is the one rebuilder (mmnto-ai/totem#3009). */
  | 'STORE_NEEDS_REBUILD';

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

/** Why a vector store needs a rebuild before a reader can use it (mmnto-ai/totem#3009). */
export type StoreNeedsRebuildReason = 'dimension-mismatch' | 'healable-open-error';

/** The fields a `StoreNeedsRebuildError` carries. */
export interface StoreNeedsRebuildDetails {
  /** The store directory (the `.lancedb/` path) that could not be used. */
  dbPath: string;
  reason: StoreNeedsRebuildReason;
  /** The vector width found in the store, when the reason is a dimension mismatch. */
  storedDimensions?: number;
  /** The vector width the configured embedder produces, when known. */
  expectedDimensions?: number;
  /** The underlying open error's message, when there is one. */
  underlyingMessage?: string;
}

/**
 * A reader opened a vector store whose format or vector dimensions only a
 * rebuild can repair (mmnto-ai/totem#3009). A reader never repairs what it
 * reads: `LanceStore.connect()` throws this instead of deleting the store,
 * and the sync pipeline, the one rebuilder, asks for the heal explicitly.
 * The message ends with the cure.
 */
export class StoreNeedsRebuildError extends TotemError {
  readonly dbPath: string;
  readonly reason: StoreNeedsRebuildReason;
  readonly storedDimensions: number | undefined;
  readonly expectedDimensions: number | undefined;
  readonly underlyingMessage: string | undefined;

  constructor(details: StoreNeedsRebuildDetails, cause?: unknown) {
    const cure = 'Run `totem sync --full` in that repository.';
    let what: string;
    if (details.reason === 'dimension-mismatch') {
      const stored =
        details.storedDimensions !== undefined ? `${details.storedDimensions}-dim` : 'different';
      const expected =
        details.expectedDimensions !== undefined
          ? `${details.expectedDimensions}-dim vectors`
          : 'a different width';
      what = `The vector store at ${details.dbPath} holds ${stored} vectors but the configured embedder produces ${expected}.`;
    } else {
      const firstLine = details.underlyingMessage?.split('\n')[0]?.trim();
      what = `The vector store at ${details.dbPath} cannot be opened${firstLine ? ` (${firstLine})` : ''}.`;
    }
    super(
      'STORE_NEEDS_REBUILD',
      `${what} A reader does not rebuild the store. ${cure}`,
      cure,
      cause,
    );
    this.name = 'StoreNeedsRebuildError';
    this.dbPath = details.dbPath;
    this.reason = details.reason;
    this.storedDimensions = details.storedDimensions;
    this.expectedDimensions = details.expectedDimensions;
    this.underlyingMessage = details.underlyingMessage;
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
