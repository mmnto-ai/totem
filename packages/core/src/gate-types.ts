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
}

export interface GateVerdict {
  disposition: GateDisposition;
  /** Human-readable rationale for the disposition. */
  reason: string;
  /** What deterministic source + value backs this verdict. Every verdict carries provenance. */
  provenance: GateProvenance;
}

/**
 * A gate evaluator may READ a deterministic source (freeze.json, a hash cache, a
 * GH query) but MUST NOT mutate any state. It returns a verdict, or throws
 * (fail-loud) on an unparseable source — it never default-allows.
 */
export type GateEvaluator = (payload: unknown, totemDir: string) => GateVerdict;

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
