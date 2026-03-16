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
  | 'NO_LESSONS'
  | 'NO_RULES'
  | 'SHIELD_FAILED'
  | 'MCP_ERROR';

export class TotemError extends Error {
  readonly code: TotemErrorCode;
  readonly recoveryHint: string;

  constructor(code: TotemErrorCode, message: string, recoveryHint: string) {
    super(`[Totem Error] ${message}`);
    this.name = 'TotemError';
    this.code = code;
    this.recoveryHint = recoveryHint;
  }
}

export class TotemConfigError extends TotemError {
  constructor(message: string, recoveryHint: string) {
    super(message.includes('invalid') ? 'CONFIG_INVALID' : 'CONFIG_MISSING', message, recoveryHint);
    this.name = 'TotemConfigError';
  }
}

export class TotemDatabaseError extends TotemError {
  constructor(message: string, recoveryHint: string) {
    super(
      message.includes('mismatch') ? 'DATABASE_MISMATCH' : 'DATABASE_CORRUPT',
      message,
      recoveryHint,
    );
    this.name = 'TotemDatabaseError';
  }
}

export class TotemCompileError extends TotemError {
  constructor(message: string, recoveryHint: string) {
    super('COMPILE_FAILED', message, recoveryHint);
    this.name = 'TotemCompileError';
  }
}

export class TotemParseError extends TotemError {
  constructor(message: string, recoveryHint: string) {
    super('PARSE_FAILED', message, recoveryHint);
    this.name = 'TotemParseError';
  }
}
