/**
 * Runtime chunker registry (ADR-097 § 5 Q3, mmnto-ai/totem#1769).
 *
 * Replaces the closed `CHUNKER_MAP` keyed by the closed `ChunkStrategy` Zod
 * enum. The registry is a string-keyed Map populated by:
 *
 * 1. Built-in chunkers self-registering at module load (this file's bottom).
 * 2. Pack registration callbacks invoked by `loadInstalledPacks()` during
 *    boot (mmnto-ai/totem#1768) — they register via the
 *    `PackRegistrationAPI.registerChunkStrategy()` surface, which calls
 *    through to `register()` in this module.
 *
 * After boot completes, the engine seals (`pack-discovery.ts` flips
 * `engineSealed = true`) and any further `register()` call throws.
 *
 * The registry has no concept of which built-in vs pack-registered an
 * entry is — that distinction is enforced at registration time (see
 * `register()` and `BUILTIN_CHUNKER_NAMES`).
 */

import type { Chunker } from './chunker.js';
import { MarkdownChunker } from './markdown-chunker.js';
import { SchemaFileChunker } from './schema-file-chunker.js';
import { SessionLogChunker } from './session-log-chunker.js';
import { TestFileChunker } from './test-file-chunker.js';
import { TypeScriptChunker } from './typescript-chunker.js';

// ─── Internal state ─────────────────────────────────

const CHUNKER_REGISTRY = new Map<string, new () => Chunker>();

/**
 * Built-in chunker names, immutable. A pack attempting to re-register one
 * of these names is rejected at the boundary in `register()`. The set is
 * populated alongside the initial registrations below; we read it at
 * registration time, so adding a new built-in only requires editing the
 * `register()` calls at the bottom of this file.
 */
const BUILTIN_CHUNKER_NAMES = new Set<string>();

/** Cleared by `__resetForTests` / `unsealForTests` — see pack-discovery.ts. */
let sealed = false;

// ─── Public API ─────────────────────────────────────

/**
 * Register a chunker under a strategy name. Called by built-ins at module
 * load and by Pack registration callbacks during boot. Throws when:
 *
 * - `engineSealed` (per `pack-discovery.ts`) is true.
 * - The strategy name is already registered (built-ins are immutable;
 *   pack-vs-pack collisions are also rejected).
 *
 * Boot vs pack distinction: built-ins call `register()` directly at
 * module-load time (sealed === false, name not yet in registry → succeeds).
 * Packs call via `PackRegistrationAPI.registerChunkStrategy` which routes
 * to this same function. The seal check + name-collision check covers both
 * in one place.
 */
export function register(name: string, chunkerCtor: new () => Chunker): void {
  if (sealed) {
    throw new Error(
      `Chunker registration after engine seal: tried to register '${name}' but engine has already started serving requests. Pack registration must complete during boot — see ADR-097 § 5 Q5.`,
    );
  }
  if (CHUNKER_REGISTRY.has(name)) {
    const existingIsBuiltin = BUILTIN_CHUNKER_NAMES.has(name);
    throw new Error(
      `Chunker '${name}' is already registered${existingIsBuiltin ? ' as a built-in (built-in entries are immutable)' : ' (pack-vs-pack collision — one of the packs must rename)'}.`,
    );
  }
  CHUNKER_REGISTRY.set(name, chunkerCtor);
}

/**
 * Look up a chunker class by strategy name. Returns undefined when the
 * name isn't registered — callers decide whether absence is a hard error
 * (Zod validation), a fail-loud at runtime (createChunker), or a soft
 * miss.
 */
export function lookup(name: string): (new () => Chunker) | undefined {
  return CHUNKER_REGISTRY.get(name);
}

/**
 * Snapshot of currently-registered strategy names. Used for:
 *
 * - `ChunkStrategySchema` validation error messages (suggesting the valid set).
 * - `totem describe` output enumerating effective strategies.
 *
 * Returns a sorted array for deterministic output.
 */
export function registeredNames(): readonly string[] {
  return [...CHUNKER_REGISTRY.keys()].sort();
}

/**
 * True iff the strategy name is one of the built-ins (vs pack-registered).
 * Used by tooling that needs to distinguish core-shipped strategies from
 * pack-contributed ones.
 */
export function isBuiltin(name: string): boolean {
  return BUILTIN_CHUNKER_NAMES.has(name);
}

/**
 * Mark the registry as sealed. After this, `register()` calls throw.
 * Called by `pack-discovery.ts` `loadInstalledPacks()` after every pack
 * callback returns.
 *
 * The seal applies process-wide. Tests that need to register additional
 * fixture chunkers between cases use `__unsealForTests()`.
 */
export function seal(): void {
  sealed = true;
}

/** True iff the registry has been sealed. */
export function isSealed(): boolean {
  return sealed;
}

// ─── Test-only helpers ──────────────────────────────

/**
 * Test-only: reset the registry and re-register built-ins. Lets per-test
 * fixtures register without leaking state across tests. NEVER call from
 * production code.
 */
export function __resetForTests(): void {
  CHUNKER_REGISTRY.clear();
  BUILTIN_CHUNKER_NAMES.clear();
  sealed = false;
  registerBuiltins();
}

/** Test-only: clear the seal so subsequent registrations succeed. */
export function __unsealForTests(): void {
  sealed = false;
}

// ─── Built-in registration (runs at module load) ────

function registerBuiltin(name: string, ctor: new () => Chunker): void {
  BUILTIN_CHUNKER_NAMES.add(name);
  register(name, ctor);
}

function registerBuiltins(): void {
  registerBuiltin('session-log', SessionLogChunker);
  registerBuiltin('markdown-heading', MarkdownChunker);
  registerBuiltin('typescript-ast', TypeScriptChunker);
  registerBuiltin('schema-file', SchemaFileChunker);
  registerBuiltin('test-file', TestFileChunker);
}

registerBuiltins();
