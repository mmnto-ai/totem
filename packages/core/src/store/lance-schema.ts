import { z } from 'zod';

/**
 * Zod schema for validating a stored chunk before insertion.
 * The vector field is not validated by Zod (handled by LanceDB).
 */
export const StoredChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  contextPrefix: z.string(),
  filePath: z.string(),
  type: z.enum(['code', 'session_log', 'spec']),
  strategy: z.enum([
    'typescript-ast',
    'markdown-heading',
    'session-log',
    'schema-file',
    'test-file',
  ]),
  label: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  metadata: z.string(), // JSON-stringified
});

/** The LanceDB table name used for all totem data. */
export const TOTEM_TABLE_NAME = 'totem_chunks';
