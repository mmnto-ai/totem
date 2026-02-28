import type { Chunk } from '../types.js';
import type { ChunkStrategy, ContentType } from '../config-schema.js';
import { SessionLogChunker } from './session-log-chunker.js';
import { MarkdownChunker } from './markdown-chunker.js';
import { TypeScriptChunker } from './typescript-chunker.js';
import { SchemaFileChunker } from './schema-file-chunker.js';
import { TestFileChunker } from './test-file-chunker.js';

/**
 * All chunkers implement this interface.
 * Given file content and metadata, produce an array of Chunks.
 */
export interface Chunker {
  readonly strategy: ChunkStrategy;

  chunk(
    content: string,
    filePath: string,
    type: ContentType,
  ): Chunk[];
}

const CHUNKER_MAP: Record<ChunkStrategy, new () => Chunker> = {
  'session-log': SessionLogChunker,
  'markdown-heading': MarkdownChunker,
  'typescript-ast': TypeScriptChunker,
  'schema-file': SchemaFileChunker,
  'test-file': TestFileChunker,
};

export function createChunker(strategy: ChunkStrategy): Chunker {
  const Ctor = CHUNKER_MAP[strategy];
  return new Ctor();
}
