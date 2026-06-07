/**
 * Rerun + compare primitives over grounded run artifacts
 * (mmnto-ai/totem#2100, strategy#474 slice 1).
 *
 * - **Rerun = same immutable bundle.** `rerunArtifact` re-invokes the
 *   recorded backend with the artifact's EXACT `inputBundle` — it never
 *   touches live retrieval (it imports none) and forces `fresh: true` so the
 *   response cache cannot replay a prior answer as if it were a new run.
 *   The rerun emits a NEW artifact; the source record is never mutated.
 *
 * - **Compare = artifact-vs-artifact diff, deterministic only.** Structural
 *   equality + content hashes + numeric metric deltas. Deliberately NO
 *   similarity scoring of any kind (#2100 review F3 / Tenet 9) — a scorer in
 *   the deterministic substrate would be an LLM-judge smuggled past the
 *   admission contract. Semantic comparison is eval-harness territory
 *   (#2103+), never a core primitive.
 */

import * as path from 'node:path';

import type { RunArtifact, TotemConfig } from '@mmnto/totem';
import { calculateDeterministicHash, loadRunArtifact } from '@mmnto/totem';

import { runOrchestrator } from '../utils.js';

// ─── Rerun ───────────────────────────────────────────────

export interface RerunArtifactOptions {
  /** Content address of the source artifact. */
  hash: string;
  config: TotemConfig;
  cwd: string;
  /** Directory containing totem.config.* — defaults to cwd (mirrors runOrchestrator). */
  configRoot?: string;
}

export interface RerunArtifactResult {
  /** The artifact the rerun replayed. */
  sourceHash: string;
  /** Content address of the NEW record the rerun emitted (append-only). */
  hash: string;
  /** Absolute path of the new record. */
  path: string;
  /** The rerun's response content. */
  content: string;
}

/**
 * Replay a recorded run against its recorded backend with zero input drift.
 * Throws (via `loadRunArtifact`) before invoking anything when the source
 * hash is missing or invalid.
 */
export async function rerunArtifact(opts: RerunArtifactOptions): Promise<RerunArtifactResult> {
  const configRoot = opts.configRoot ?? opts.cwd;
  const totemDirAbs = path.join(configRoot, opts.config.totemDir);
  const source = loadRunArtifact(totemDirAbs, opts.hash);

  let emitted: { hash: string; path: string } | undefined;
  const content = await runOrchestrator({
    prompt: source.inputBundle.maskedPrompt,
    ...(source.inputBundle.maskedSystemPrompt !== undefined
      ? { systemPrompt: source.inputBundle.maskedSystemPrompt }
      : {}),
    tag: source.backend.taskProfile,
    // fresh: a response-cache replay is not a rerun (silent drift, same trap
    // class as live-retrieval leakage). model: the RESOLVED backend recorded
    // at emission, not whatever the config resolves to today.
    options: { fresh: true, model: source.backend.qualifiedModel },
    config: opts.config,
    cwd: opts.cwd,
    configRoot,
    ...(source.backend.temperature !== undefined
      ? { temperature: source.backend.temperature }
      : {}),
    artifact: {
      // The rerun makes no new grounding claim — identity carried verbatim.
      groundingHash: source.grounding.hash,
      provenanceSummary: source.grounding.provenanceSummary,
      ...(source.inputBundle.diffScope !== undefined
        ? { diffScope: source.inputBundle.diffScope }
        : {}),
      ...(source.inputBundle.specContract !== undefined
        ? { specContract: source.inputBundle.specContract }
        : {}),
      onEmitted: (hash, artifactPath) => {
        emitted = { hash, path: artifactPath };
      },
    },
  });

  if (content === undefined || emitted === undefined) {
    // --raw can't happen (we don't pass it), so this is an emission failure —
    // the rerun ran but its record didn't land. Loud, not a silent partial.
    throw new Error(
      `Rerun of ${opts.hash.slice(0, 12)}… completed but no artifact was recorded — see the emission warning above.`,
    );
  }

  return { sourceHash: opts.hash, hash: emitted.hash, path: emitted.path, content };
}

// ─── Compare ─────────────────────────────────────────────

export interface RunArtifactComparison {
  /** `inputHash` equality — same logical bundle in. */
  sameInput: boolean;
  /** Grounding hash + provenance equality. */
  sameGrounding: boolean;
  /** Backend identity equality across all recorded fields. */
  sameBackend: boolean;
  /** Backend field names that differ (empty when sameBackend). */
  backendDelta: string[];
  /** Byte equality of output content. */
  sameOutput: boolean;
  outputDelta: {
    contentHashA: string;
    contentHashB: string;
  };
  /** Numeric deltas, B minus A; null when either side did not report. */
  metricsDelta: {
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

/** Backend fields compared one by one so the delta NAMES what changed. */
const BACKEND_FIELDS = [
  'provider',
  'model',
  'qualifiedModel',
  'admissionClass',
  'taskProfile',
  'temperature',
] as const;

/** Numeric delta honoring honest-absent: null in, null out — never NaN. */
function tokenDelta(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return b - a;
}

/**
 * Deterministic artifact-vs-artifact diff. Pure function of its two inputs —
 * no I/O, no scoring, no randomness.
 */
export function compareRunArtifacts(a: RunArtifact, b: RunArtifact): RunArtifactComparison {
  const backendDelta = BACKEND_FIELDS.filter((field) => a.backend[field] !== b.backend[field]);

  return {
    sameInput: a.inputHash === b.inputHash,
    sameGrounding:
      a.grounding.hash === b.grounding.hash &&
      a.grounding.provenanceSummary === b.grounding.provenanceSummary,
    sameBackend: backendDelta.length === 0,
    backendDelta,
    sameOutput: a.output.content === b.output.content,
    outputDelta: {
      contentHashA: calculateDeterministicHash(a.output.content),
      contentHashB: calculateDeterministicHash(b.output.content),
    },
    metricsDelta: {
      durationMs: b.output.metrics.durationMs - a.output.metrics.durationMs,
      inputTokens: tokenDelta(a.output.metrics.inputTokens, b.output.metrics.inputTokens),
      outputTokens: tokenDelta(a.output.metrics.outputTokens, b.output.metrics.outputTokens),
    },
  };
}

/** Load-then-compare convenience for the CLI verb. */
export function compareArtifacts(
  totemDirAbs: string,
  hashA: string,
  hashB: string,
): RunArtifactComparison {
  return compareRunArtifacts(
    loadRunArtifact(totemDirAbs, hashA),
    loadRunArtifact(totemDirAbs, hashB),
  );
}
