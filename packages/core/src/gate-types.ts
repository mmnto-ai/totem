/**
 * Shared types for the totem gate engine (WS3, Proposal 288 §6.2).
 *
 * A gate evaluates a DECIDABLE PREDICATE against DETERMINISTIC STATE and returns
 * a host-agnostic verdict. The verdict IS the contract: any host (Claude
 * PreToolUse, Gemini/Codex wrappers, humans-advisory) maps `disposition` onto
 * its own exit-code / enforcement convention. The engine never maps to exit
 * codes and never mutates state (side-effect-free).
 */

/**
 * Host-agnostic verdict outcome — the host maps each onto its own enforcement
 * convention (e.g. Claude PreToolUse exit 0/2):
 *  - `allow` — predicate passed; permit the action.
 *  - `warn`  — predicate flagged; advisory only, do NOT block (first emitter:
 *              `transport-shield`'s win32 `<rev>:<path>`-in-subshell and
 *              heredoc-oversize rows, mmnto-ai/totem#2799).
 *  - `deny`  — predicate failed; block the action.
 */
export type GateDisposition = 'allow' | 'warn' | 'deny';

export interface GateProvenance {
  /** The deterministic source consulted (e.g. `.totem/freeze.json`, or a module label). */
  source: string;
  /** A stable reference for what was checked (e.g. the subsystem, or `no-freeze-file`). */
  ref: string;
  /** The concrete value that produced the verdict (e.g. the matched frozen subsystem), or null. */
  matched: string | null;
  /** ISO-8601 timestamp of when the check ran. */
  checkedAt: string;
  /**
   * Optional gate-specific evidence, emitted with the verdict and never stored
   * (mmnto-ai/totem#2800): merge-ready carries its head sha, check counts,
   * thread counts, `changesRequestedBy`, `highInline`, `mergeStateStatus` and
   * `evaluatedBy` here. Hosts treat it as opaque passthrough — the wrapper
   * prints it and branches ONLY on `disposition`.
   */
  detail?: Readonly<Record<string, unknown>>;
}

export interface GateVerdict {
  disposition: GateDisposition;
  /** Human-readable rationale for the disposition. */
  reason: string;
  /** What deterministic source + value backs this verdict. Every verdict carries provenance. */
  provenance: GateProvenance;
}

/**
 * Enforcement tier for the UNEVALUABLE class, PER GATE (mmnto-ai/totem#2800 R1).
 * A gate whose predicate INPUT could not be derived returns `warn` under
 * `pilot` and `deny` under `strict` — and only where its own charter says so:
 * `freeze-check` fails closed at every tier (a corrupt freeze file is never a
 * pilot warning). A tier NEVER softens a predicate that actually failed; the
 * host's tier map owns that.
 */
export type GateTier = 'strict' | 'pilot';

/**
 * The injected `gh` seam (mmnto-ai/totem#2800 R3): run `gh` with an argv —
 * never a shell string — and report what it wrote and how it exited.
 * Production spawns; tests hand back checked-in captures.
 */
export type GhRunner = (args: string[]) => { stdout: string; exitCode: number };

/**
 * Per-evaluation context. Every field is optional and defaulted, so a gate that
 * reads none of it keeps the two-argument call shape.
 */
export interface GateContext {
  /** Tier for the UNEVALUABLE class (default `strict`); consulted per gate. */
  tier?: GateTier;
  /** The `gh` seam for gates that read GitHub (default: spawn the real `gh`). */
  ghRunner?: GhRunner;
  /** Environment a gate reads its documented env keys from (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Sink for a gate's agent-facing stderr lines (default `process.stderr.write`). */
  writeStderr?: (line: string) => void;
}

/**
 * A gate evaluator may READ a deterministic source (freeze.json, a hash cache, a
 * GH query) but MUST NOT mutate any state. It returns a verdict, or throws
 * (fail-loud) on an unparseable source — it never default-allows.
 */
export type GateEvaluator = (
  payload: unknown,
  totemDir: string,
  context?: GateContext,
) => GateVerdict;

/**
 * The PreToolUse tool matcher a gate installs under (mmnto-ai/totem#2799).
 * Carried by the core registry so the installer never guesses: a gate over
 * file writes matches `Write|Edit`; a gate over shell commands matches
 * `Bash|PowerShell`. Extend the union when a gate over a third tool family
 * lands — never widen an existing gate's matcher.
 */
export type GateMatcher = 'Write|Edit' | 'Bash|PowerShell';

/** A registry entry: the evaluator plus the matcher its host entry installs under. */
export interface GateDefinition {
  evaluator: GateEvaluator;
  matcher: GateMatcher;
}
