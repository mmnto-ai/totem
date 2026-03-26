import * as fs from 'node:fs';

import type { ZodSchema } from 'zod';

import { TotemParseError } from '../errors.js';

/**
 * Read and parse a JSON file with optional Zod validation.
 * Differentiates ENOENT, SyntaxError, and schema validation failures.
 * All errors thrown as TotemParseError with ES2022 cause chains.
 */
export function readJsonSafe<T = unknown>(filePath: string, schema?: ZodSchema<T>): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TotemParseError(
        `File not found: ${filePath}`,
        `Check that ${filePath} exists.`,
        err,
      );
    }
    throw new TotemParseError(
      `Cannot read file: ${filePath}`,
      `Check file permissions for ${filePath}.`,
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TotemParseError(
      `Invalid JSON in ${filePath}`,
      'The file contains malformed JSON. Check for syntax errors.',
      err,
    );
  }

  if (!schema) return parsed as T;

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new TotemParseError(
      `Schema validation failed for ${filePath}: ${issues}`,
      'The file structure does not match the expected schema.',
    );
  }

  return result.data;
}
