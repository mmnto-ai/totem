import * as crypto from 'node:crypto';
import * as path from 'node:path';

import { z } from 'zod';

/**
 * One record per rule-batch evaluation emitted by `RegexEvaluator` to the
 * Totem telemetry sink (mmnto-ai/totem#1641). Crosses the disk /
 * observability boundary, so validated with Zod rather than a plain TS
 * interface: malformed telemetry should fail loud at write rather than
 * silently polluting the sink that downstream tooling will parse.
 *
 * Path-redaction discipline lives in `redactPath` below; raw absolute
 * paths only appear when the operator opts in via `--telemetry-full-paths`
 * (the evaluator passes the redacted or raw path to this schema; the
 * schema itself does not enforce which variant is recorded).
 */
export const RegexTelemetrySchema = z.object({
  ruleHash: z.string().min(1),
  redactedPath: z.string().min(1),
  matchedInputSize: z.number().int().nonnegative(),
  elapsedTimeMs: z.number().nonnegative(),
  timeoutTriggered: z.boolean(),
  softWarningTriggered: z.boolean(),
});

export type RegexTelemetry = z.infer<typeof RegexTelemetrySchema>;

/**
 * Normalize a file path into a redaction-safe form for telemetry.
 *
 * Paths inside the repo root are returned as repo-relative; paths outside
 * the repo root collapse to `<extern:<sha256-12>>` so `/tmp/foo`,
 * `C:\Users\alice\secret.ts`, or a sibling-repo path cannot leak into the
 * telemetry sink unintentionally. The extern hash is stable so deduping
 * and pattern-spotting still work across runs.
 *
 * Callers that want raw absolute paths must opt in explicitly at the
 * evaluator layer (e.g., `--telemetry-full-paths`) and bypass this helper.
 */
export function redactPath(absOrRelPath: string, repoRoot: string): string {
  const normalizedRoot = path.resolve(repoRoot);
  const normalizedPath = path.isAbsolute(absOrRelPath)
    ? path.resolve(absOrRelPath)
    : path.resolve(normalizedRoot, absOrRelPath);

  if (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + path.sep) ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    const relative = path.relative(normalizedRoot, normalizedPath);
    return relative.split(path.sep).join('/');
  }

  const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex').slice(0, 12);
  return `<extern:${hash}>`;
}
