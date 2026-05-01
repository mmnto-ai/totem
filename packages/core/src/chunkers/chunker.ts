import type { ContentType } from '../config-schema.js';
import type { Chunk } from '../types.js';
import { lookup } from './chunker-registry.js';

/**
 * All chunkers implement this interface.
 * Given file content and metadata, produce an array of Chunks.
 */
export interface Chunker {
  readonly strategy: string;

  chunk(content: string, filePath: string, type: ContentType): Chunk[];
}

/**
 * Resolve a strategy name to a fresh chunker instance via the registry.
 *
 * Pre-ADR-097 the strategy → constructor mapping was a closed `Record`
 * keyed by the closed `ChunkStrategy` Zod enum (mmnto-ai/totem#1769).
 * Now the lookup goes through `chunker-registry.ts`, which is populated
 * by built-ins at module load and extended by Pack registration
 * callbacks during boot.
 *
 * Fail-loud per Tenet 4: an unregistered strategy name names the missing
 * pack (callers consume the registry's `registeredNames()` for context).
 * Schema validation (`ChunkStrategySchema`) catches misconfigured strategy
 * names at config-load time, so reaching this fail-loud at runtime is an
 * architectural error.
 */
export function createChunker(strategy: string): Chunker {
  const Ctor = lookup(strategy);
  if (!Ctor) {
    throw new Error(
      `Unknown chunk strategy: '${strategy}'. The strategy is not registered — either install the pack that provides it or correct the strategy name in totem.config.ts.`,
    );
  }
  return new Ctor();
}
