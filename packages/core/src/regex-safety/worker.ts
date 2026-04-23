/**
 * Regex-safety worker thread body (mmnto-ai/totem#1641).
 *
 * Receives an `EvaluateRequest` from the main thread, compiles the pattern
 * once, iterates every input line, and posts back an `EvaluateResponse`
 * with matched line indices. If the pattern fails to compile (invalid
 * regex syntax), the response carries an `error` variant; the main thread
 * keeps the worker alive because syntax errors are cheap and per-batch.
 *
 * The main-thread `RegexEvaluator` wraps each request in a timeout; if
 * evaluation of a single line catastrophic-backtracks, the worker thread
 * hangs (JavaScript cannot interrupt a running regex). The main thread
 * then calls `worker.terminate()` and respawns. This file never sees the
 * termination path — it only handles the normal-return paths.
 */

import { parentPort } from 'node:worker_threads';

export type EvaluateRequest = {
  id: string;
  pattern: string;
  flags: string;
  lines: readonly string[];
};

export type EvaluateResponse =
  | { id: string; kind: 'ok'; matchedIndices: number[] }
  | { id: string; kind: 'error'; message: string };

parentPort?.on('message', (msg: EvaluateRequest) => {
  // Test-only crash hook for the evaluator's exit-handler regression
  // test (mmnto-ai/totem#1641 GCA round-1). Gated on the env var
  // `TOTEM_TEST_WORKER_CRASH_HOOK=1` so an attacker-supplied pattern
  // matching the sentinel string cannot crash a production worker.
  // Production code never sets this env var; only the evaluator test
  // opts in via process.env before constructing the evaluator.
  if (process.env.TOTEM_TEST_WORKER_CRASH_HOOK === '1' && msg.pattern === '__TOTEM_TEST_CRASH__') {
    process.exit(1);
  }

  const { id, pattern, flags, lines } = msg;

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags); // totem-context: rethrow-via-IPC — the catch converts a compile-time RegExp syntax error into a structured `error`-kind response on the parent-thread message channel; main thread rethrows via TotemParseError at apply-rules-bounded.ts.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: EvaluateResponse = { id, kind: 'error', message };
    parentPort?.postMessage(response);
    return;
  }

  const matchedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // `re.test` updates `lastIndex` when the `g` flag is set; resetting
    // between iterations keeps per-line behavior stable regardless of
    // flags the caller supplied.
    re.lastIndex = 0;
    if (re.test(lines[i] ?? '')) {
      matchedIndices.push(i);
    }
  }
  const response: EvaluateResponse = { id, kind: 'ok', matchedIndices };
  parentPort?.postMessage(response);
});
