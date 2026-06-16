# Changelog

## 1.64.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.64.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.63.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.62.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.61.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.60.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.59.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.59.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.58.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.58.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.57.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.56.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.55.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.55.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.54.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.54.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.9

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.8

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.7

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.6

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.5

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.4

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.52.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.51.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.50.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.48.0

_Cohort-link bump for the Node 24 engine constraint enforcement shipping with this release. The `engines.node: >=24` declaration aligns @mmnto/pack-rust-architecture's declared compatibility with the cohort's tested CI floor. See `@mmnto/cli` CHANGELOG for the full release rationale._

## 1.47.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.47.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.46.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.45.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.44.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.6

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.5

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.4

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.42.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.41.0

Coordinated cohort bump — no direct changes in this package; consumes the `@mmnto/totem` minor.

## 1.40.2

### Patch Changes

- d725010: fix(ci): audit + sweep narrow timing thresholds across packages

  Three independent CI flakes hit across three platforms in three hours after the #1928 merge to main, each on a different timing-window assertion:
  - **Ubuntu** (`@mmnto/mcp` `ledger-writer.test.ts`): vitest `testTimeout` 5_000ms tripped on cold-import (fixed in #1928).
  - **macOS** (`@mmnto/totem` `regex-safety/evaluator.test.ts:97`): `softWarningMs: 1` + 1000 trivial-pattern lines finished <1ms on fast hardware; `softWarningTriggered` assertion flipped false.
  - **Windows** (`@mmnto/cli` `run-compiled-rules.test.ts:203`): `RegexEvaluator` `DEFAULT_CONFIG.timeoutMs: 100` tripped at "timeout after 139ms" on a single-line `.sh` corpus — Windows worker thread spawn + IPC + shared-runner scheduling jitter exceeded the budget.

  This PR audits and uniformly addresses the class:

  **1. Vitest test-runner ceilings (4 configs)** — `packages/{cli,core,pack-agent-security,pack-rust-architecture}/vitest.config.ts` bumped non-Windows floor `5_000` → `15_000` to match the `@mmnto/mcp` precedent set in #1928. Windows stays at 30_000 (subprocess spawn). Comments updated to call out the shared-runner cold-import class explicitly.

  **2. `RegexEvaluator` production defaults** (`packages/core/src/regex-safety/evaluator.ts`) — `timeoutMs: 100 → 250`, `softWarningMs: 50 → 100`. 250ms keeps per-rule budget snappy in production while giving Windows worker IPC + CI scheduling ~2× headroom over the observed worst case (139ms). Backward compatible: callers passing explicit config are unaffected; callers using defaults gain headroom.

  **3. Soft-warning wall-clock test** (`packages/core/src/regex-safety/evaluator.test.ts:92`) — refactored from `softWarningMs: 1` + 1000 lines to `softWarningMs: 5` + 50_000 lines. Same assertion, but 50× wall-clock margin instead of a 1ms threshold racing fast hardware.

  No public API change. Verified locally: 2161 `@mmnto/cli` tests + matching cohort across `@mmnto/totem`, `@mmnto/mcp`, and the two packs all green.

## 1.40.1

Coordinated cohort bump — no direct changes to this pack.

## 1.40.0

### Minor Changes

- 986825c: feat(mcp+cli): Trap Ledger activity writers — MCP `mcp_call` + SessionStart `session_start` (A.3.a writers)

  Stacked on #1919 (A.3.a schema). Wires the two activity-event writers that the A.3.b compliance metric will read. Without these writers, the schema is inert — no events of the new types get produced.

  ## Writers shipped

  **MCP `mcp_call` writer** (`packages/mcp/src/ledger-writer.ts`):
  - New `logMcpCall(activityName)` helper. Fire-and-forget; internal try/catch + outer `.catch()` defense-in-depth at call sites.
  - Wired into `packages/mcp/src/tools/search-knowledge.ts` — emits `{ type: 'mcp_call', activity_name: 'search_knowledge', session_id, source: 'bot' }` at handler entry. Reads `session_id` from `.totem/ledger/.session-id` if present (TTL 24h), omits when missing.
  - Other MCP tools (`describe_project`, `add_lesson`, `verify_execution`) intentionally NOT wired in this PR — `search_knowledge` is the only one ADR-029's compliance metric measures. Symmetric wiring deferred to A.3.c when broader observability lands.

  **SessionStart hook writer** (`packages/cli/src/commands/init-templates.ts`):
  - `CLAUDE_SESSION_START` template extended to mint a session UUID via `crypto.randomUUID()`, persist to `.totem/ledger/.session-id`, and append a `session_start` activity event to `events.ndjson` BEFORE the existing `totem describe` briefing.
  - Inline implementation (no `@mmnto/totem` import) — hook scripts run via `node` from project root before any package resolution, so they can't depend on the totem npm packages being installed.
  - Gemini SessionStart hook (`GEMINI_SESSION_START`) intentionally NOT updated in this PR. Symmetric Gemini parity deferred to a follow-on.

  ## New core utilities (`packages/core/src/session-id.ts`)
  - `mintSessionId()` — wraps `crypto.randomUUID()`.
  - `writeSessionId(totemDir, sessionId)` — persists to `.totem/ledger/.session-id`. Swallows expected fs error classes (ENOENT/EACCES/EPERM/EROFS) via the optional `onWarn` callback and rethrows unexpected error classes per Tenet 4 Fail Loud.
  - `readSessionId(totemDir, ttlHours?)` — reads + validates UUID shape + checks mtime against TTL (default 24h). Returns `undefined` for missing/expired/malformed files.

  ## Tests
  - `packages/core/src/session-id.test.ts` — 15 tests covering mint uniqueness, write/read round-trip, malformed UUID rejection, TTL expiration (file backdating via `utimesSync`), custom TTL argument, trailing-whitespace tolerance, plus fs error class discrimination on read (ENOENT/EACCES/EPERM/EROFS swallow vs unexpected rethrow per Tenet 4).
  - `packages/mcp/src/ledger-writer.test.ts` — 5 tests covering event emission, session_id population/omission, getContext failure (must not throw), append-don't-overwrite.
  - `packages/mcp/src/tools/search-knowledge.test.ts` — 2 new integration tests verifying handler emits `mcp_call` with `activity_name: 'search_knowledge'`, including the dimension-mismatch error path (invocation, not success, is what ADR-029 measures).
  - `packages/cli/src/commands/init.test.ts` — 5 new tests covering the SessionStart template's session-id minting, persistence, ledger-event emission, agent_source stamping (Claude-specific), and fire-and-forget error-handling.

  ## Backward compatibility

  Same forward-only story as A.3.a schema:
  - Pre-writers Trap Ledgers don't contain `mcp_call` or `session_start` events — readers parse them fine when they appear post-upgrade.
  - SessionStart hook ledger-write block is in its own try/catch; if it fails (read-only filesystem, missing perms, etc.), the briefing path still runs.

  ## ADR alignment
  - ADR-029 § Session Heuristic: explicit UUID supersedes the rolling-2h activity heuristic when `.session-id` is present.
  - ADR-078 § Event Attribution: `source: 'bot'` for both writers (emitter = MCP server / hook subsystem). In this lift, `session_start` includes `agent_source: 'claude'` (the Claude hook template knows its vendor); MCP `mcp_call` agent attribution is deferred to A.3.c via orchestrator → MCP correlation propagation.
  - ADR-077 Smart Briefing: SessionStart hook already shipped (`installClaudeHooks` scaffolds the script); this PR only extends its body.

  ## Out of scope (next sub-lifts)
  - **A.3.b** — `totem doctor --compliance` reads these events and computes the ADR-029 metric (~1 week).
  - **A.3.c** — orchestrator → MCP correlation_id propagation; populates `agent_source` (~1 week).
  - **A.4.a / A.4.b** — PreToolUse soft-block + pre-push hard-block (per C-12); reads `mcp_call` events to gate Write/Edit on `proposals/active/**`, `adr/**`, `research/**`.
  - **Gemini SessionStart writer** — symmetric pattern, deferred for parity sweep.
  - **Other MCP tools** (`describe_project`, `add_lesson`, `verify_execution`) — wire `logMcpCall` when needed for broader observability.

## 1.39.0

### Minor Changes

- 1934f13: feat(core): Trap Ledger schema extension — agent attribution + activity events (A.3.a)

  Forward-only schema extension to `LedgerEventSchema` in `packages/core/src/ledger.ts`. First lift of the A.3 telemetry sprint (three-stream claim-discipline consensus, design doc at `mmnto-ai/totem-substrate:.handoff/_shared/2026-05-15-a3a-schema-extension-design.md`).

  **New event types** (activity family):
  - `mcp_call` — MCP tool invocation; `activity_name` discriminates (`search_knowledge`, `describe_project`, ...)
  - `tool_call_first_significant` — first non-Read/Grep/Glob orchestrator tool call in session
  - `hook_fire` — lifecycle hook executed; `activity_name` discriminates (`SessionStart`, `PreToolUse`, `pre-push`, ...)
  - `session_start` — SessionStart hook fired; new `session_id` minted

  **New optional fields:**
  - `agent_source: 'claude' | 'gemini' | 'human'` — agent runtime attribution, orthogonal to `source` (emitting subsystem). Implements ADR-078 § Event Attribution; renamed from the ADR's `source` to disambiguate against the load-bearing emitter identifier already in production.
  - `session_id` (UUID) — session correlation, persisted at `.totem/ledger/.session-id` per ADR-029 § Session Heuristic.
  - `correlation_id` (UUID) — trace correlation per ADR-014; populated by A.3.c end-to-end propagation work.
  - `activity_name` — sub-type discriminator for activity events.

  **Field relaxations:** `ruleId` and `file` are now optional at the schema level to accommodate activity events. Writer-side discipline enforces required-by-type for `suppress` / `override` / `exemption`. Promotion to a Zod `discriminatedUnion` is deferred to A.3.c per design doc OQ-1 (strategy-Claude T0345Z disposition agreed; rationale and gap-filler tests in `ledger.test.ts` § "writer-side per-branch field presence" lock the discipline until the schema enforces it structurally).

  **Backward compatibility:**
  - Pre-A.3.a override events (no new fields) parse fine — all new fields optional.
  - Post-A.3.a activity events read by pre-A.3.a code: silently dropped (`safeParse` fails on unknown enum value, line skipped). Acceptable — no data corruption, only telemetry-visibility loss in stale tooling. Cohort version bump after merge closes this naturally.

  **Doc-sync (bundled):** `docs/wiki/trap-ledger.md` example corrected — pre-existing drift surfaced during A.3.a empirical pass. Three drifts fixed:
  - Example `type` was `"exception"` (invalid; not in the enum) → now `"suppress"`.
  - Example `source` was `"totem-context"` (bypass-marker; conflated with code's emitter identifier) → now `"lint"`.
  - Prose claimed `// totem-context:` directives log `override` events — corrected to `suppress` per code comment in `LedgerEventSchema.type`.

  Activity-event example added for `mcp_call` / `search_knowledge` shape.

  **Out of scope (next sub-lifts):**
  - A.3.b: `totem doctor --compliance` reads this schema and computes the ADR-029 metric (~1 week).
  - A.3.c: orchestrator → MCP `correlation_id` propagation (~1 week).
  - A.4.a / A.4.b: PreToolUse soft-block + pre-push hard-block pair (per C-12, ships alongside A.3.a).

  ADR-078 surface amendment (rename agent attribution from `source` to `agent_source` in § Decision 2) landed at `mmnto-ai/totem-strategy#329` (commit `b830e0c` on main). Includes the first `Falsifying Metric:` field in the ecosystem per Tenet 19 — sibling capability-claim ADRs 014/029/044 backfilled in `mmnto-ai/totem-strategy#330`.

## 1.38.0

### Minor Changes

- 923deb0: feat(doctor): add `--strict` mode + pre-push hook integration + CI workflow template (#1908)

  Implements Proposal 273 § 7 routing matrix rows 5+6 (Repo + Auto + Both) for the first repo-state diagnostic (`checkAgentsMdCanonical`, shipped in #1907).
  - `totem doctor --strict` now exits non-zero when any check reports `fail` (`warn` results remain informational). Default behavior unchanged.
  - Pre-push hook injects `totem doctor --strict` inside the existing strict-tier guard (`is_agent=1` or `TOTEM_HOOK_TIER=strict`), mirroring the `totem review` shield gate. Standard-tier humans bypass; agents and explicit strict-tier operators get the gate.
  - New `.github/workflows/totem-doctor.yml` template runs `doctor --strict` on PR + push to main. Cohort repos can copy or reference.

  Exit-code decision lives at the CLI edge — `doctorCommand` returns `DiagnosticResult[]` and does not touch `process.exit` / `process.exitCode`.

  **Calibration fix bundled.** `checkEmbeddingConfig` previously reported `fail` when the configured embedder's env key (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY`) was missing. That misclassified an operator-setup state as a repo defect — empirically surfaced when `totem doctor --strict` ran in CI on this PR (CI intentionally lacks the keys). Both branches now return `warn`, mirroring `checkOllama`'s warn-on-unreachable pattern. The repo's config is correct; the local environment is incomplete.

## 1.37.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.36.0

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/cli`'s
CHANGELOG.md for the `totem hook` namespace entry.

## 1.35.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.1

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/totem`'s
CHANGELOG.md for the `generateLessonHeading`/`truncateHeading` mid-clause truncation fix.

## 1.34.0

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/cli`'s
CHANGELOG.md for the `totem init` Ollama floor probe entry.

## 1.33.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.32.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.31.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.30.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.30.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.29.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.28.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.28.0

### Minor Changes

- bd3fd71: `totem sync` Phase A / Phase B architectural separation (mmnto-ai/totem#1811, ADR-101).

  `totem sync` decomposes into two independently-runnable phases:
  - **Phase A** — deterministic pack-resolution + `installed-packs.json` write (no API key required, runs in CI).
  - **Phase B** — vector-store embedding sync (still requires the embedding key; unchanged).

  New mutually-exclusive flags on `totem sync`:
  - `--packs-only` (Lite tier): write the pack manifest only; skip embedding sync, prune, the global registry update, and the `review-extensions.txt` write. Designed for CI environments without API keys after a `@mmnto/totem` cohort bump where pack-resolution alone needs to run before `totem lint` recognizes newly registered Tree-sitter languages.
  - `--index-only` (Standard tier): run only the embedding sync; skip pack-resolution. Use when `installed-packs.json` is already current and only the vector store needs to re-embed.

  `--packs-only` hard-errors when combined with `--index-only`, `--full`, or `--prune` — Phase B is skipped under `--packs-only`, so those flags would silently no-op. `--index-only` composes with `--full` and `--prune` since all three modify Phase B.

  The CLI orchestrator now writes `installed-packs.json` BEFORE invoking `runSync` so `--packs-only` can short-circuit cleanly. The default flag-less behavior is observably equivalent to prior releases.

  UX nudge for stale manifests: when a rule expects a Tree-sitter language that isn't registered, the rule-engine now consults `installed-packs.json`'s cohort field and surfaces a structured `STALE_MANIFEST` `TotemError` pointing at `totem sync --packs-only` whenever the manifest is missing, pre-1.27.0, or written by an engine whose `major.minor` differs from the running version. Patch-level cohort drift passes (caret-range pack semver tolerance). Cohort-match falls through to the original "install the pack" `TotemParseError`.

  Schema: `InstalledPacksManifestSchema` gains an optional `cohort: string` field (semver). Pre-1.27.0 manifests without the field continue to parse cleanly. Stamped at write time by `writeInstalledPacksManifest()` from `resolveEngineVersion()`; tests can pre-populate the field to override the stamp.

  New public surfaces (additive):
  - `resolveEngineVersion(): string`
  - `detectStaleManifest(opts): StaleManifestDetection | null`
  - `staleManifestError(detection, context): TotemError`
  - `TotemErrorCode` adds `'STALE_MANIFEST'` and `'FLAG_CONFLICT'`.

## 1.27.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.26.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.26.0

### Minor Changes

- c00dc7b: **ADR-097 § Q6 amended — engine-version constraint moves from `peerDependencies` to `engines` (closes #1803).**

  Pack manifest resolver (`pack-manifest-writer.ts:readEngineRange`, formerly `readPeerEngineRange`) now reads `engines['@mmnto/totem']` from the resolved pack's `package.json` instead of `peerDependencies['@mmnto/totem']`. The boot-time engine-version cross-check (`pack-discovery.ts:assertEngineRangeSatisfied`) reads the same value via `installed-packs.json#packs[].declaredEngineRange` and continues to fail loud on semver mismatch.

  **Why the move:**
  - `engines` is npm-canonical for engine-version constraints. `peerDependencies` is for actual peer packages the consumer must install (e.g., `@ast-grep/napi`). Mechanism mapping is now correct.
  - Symmetry across the cohort. Internal and future external packs declare `engines.@mmnto/totem` consistently; `peerDependencies` is uniformly for actual peer packages only.
  - Closes the structural collision with `mmnto-ai/totem#1777` (the `1.22.0 → 2.0.0` wiggle root cause): a fixed-group sibling pack cannot peer-dep `@mmnto/totem` without triggering a changesets MAJOR cascade. The `engines` field is not touched by changesets fixed-group auto-bump, so the wiggle stays prevented even with a declared engine constraint.

  **Migration shape:**
  - `@mmnto/pack-rust-architecture` and `@mmnto/pack-agent-security` now declare `"engines": { "@mmnto/totem": "^1.25.0" }`. Neither declares `@mmnto/totem` in `peerDependencies` (locked by `structure.test.ts` invariants in both packs).
  - The `not-a-pack` warning in `totem sync` was reworded to point at the actual gap: `"missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish."` Pre-#1803 text was misleading per `mmnto-ai/totem#1803`'s reproducer (it claimed the registration callback was missing when the callback was correctly exported).
  - No fallback to the legacy `peerDependencies['@mmnto/totem']` slot. Pre-1.26.0 packs that declared the engine constraint via peerDeps (none known to exist outside the `@mmnto/*` cohort, all of which are migrated in this cohort) must republish with `engines` declared.

  Closes #1803.

### Patch Changes

- 9f0535d: **Fix `engines['@mmnto/totem']` constraint floor — `^1.25.0` → `^1.26.0`.**

  GCA HIGH catch on the auto-generated Version Packages PR (#1808). The engines-field reader (`pack-manifest-writer.ts:readEngineRange`) ships in `@mmnto/totem@1.26.0`. Engines pre-1.26.0 read `peerDependencies['@mmnto/totem']` and would silently treat these packs as `not-a-pack` (the engines field is invisible to them). Declaring compatibility with `^1.25.0` was technically incorrect — a 1.25.0 engine cannot satisfy these packs even though caret-semver would let it match.

  Tightening the floor to `^1.26.0` makes the constraint match actual runtime compatibility. Fixed-group co-versioning makes this a documentation / safety-rail correction in practice (consumers pinned to a 1.26.x pack pull in the matching 1.26.x engine via the cohort), but the declared range should reflect reality.

  No code change. Constraint-only tightening.

## 1.25.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.24.0

### Minor Changes

- 67c3ad3: **ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion (#1684)**

  Closes the cloud-compile bootstrap gap that ADR-091 § Bootstrap Semantics defined: pack rules cannot be trusted to fire on the consumer's codebase until Stage 4 verifies them locally, so they now enter the consumer's manifest as `'pending-verification'` and the next `totem lint` runs the verifier and promotes them per outcome.

  **`CompiledRule.status` enum extended** with a fourth lifecycle value `'pending-verification'` alongside `'active' | 'archived' | 'untested-against-codebase'`. The lint-execution path (`loadCompiledRules`) treats it as inert exactly like `'archived'` and `'untested-against-codebase'`; the admin path (`loadCompiledRulesFile`) returns it unfiltered so the promotion interceptor can find pending entries.

  **`totem install pack/<name>`** now stamps every pack rule `'pending-verification'` regardless of the status the pack shipped with. The pack's authoring environment cannot have run Stage 4 against the consumer's codebase, so the cloud-compile status is meaningless on the consumer side. The install command appends `Run \`totem lint\` to activate pack rules` to its output as the activation hint.

  **`.totem/verification-outcomes.json`** is the new committable side-table that memoizes Stage 4 outcomes across runs. The first lint run after install reads pending rules from the manifest, invokes the Stage 4 verifier on each, maps the outcome to one of the four terminal lifecycle values per Invariant #3, atomically writes the outcomes file with canonical-key-order serialization (Invariant #11 — byte-stable across runs so consumer repos see no phantom diffs), and saves the mutated manifest. Subsequent lint runs read the recorded outcome from the file and skip re-verification (Invariant #4); a pack content update produces a new `lessonHash` which has no recorded outcome, so the verifier runs again (Invariant #5).

  **Per-rule verifier-throw isolation** (Invariant #7): one failing rule's verifier-throw does not abort the lint pass; that rule remains `'pending-verification'` and the next lint retries.

  **Empty-pending fast path** (Invariant #9): the common-case lint pass with zero pending rules pays no verification cost and skips the outcomes-file read entirely.

  **New public API** in `@mmnto/totem`:
  - `promotePendingRules(rules, deps)` and `applyOutcomeToRule(rule, entry)` — the core interceptor.
  - `readVerificationOutcomes(filePath, onWarn?)` and `writeVerificationOutcomes(filePath, outcomes)` — the persistence layer.
  - `VerificationOutcomeEntrySchema`, `VerificationOutcomesFileSchema`, `Stage4OutcomeStored` — Zod schemas.
  - `VerificationOutcomesStore`, `VerificationOutcomesFile`, `VerificationOutcomeEntry`, `Stage4OutcomeStoredValue`, `PromotePendingRulesDeps`, `PromotePendingRulesResult` — types.

  **Naming-collision context (option B):** the original ADR-091 draft specified `.totem/rule-metrics.json` for the verification-outcomes file, but `packages/core/src/rule-metrics.ts` already exists as a per-machine telemetry-cache module (`triggerCount`, `suppressCount`, `evaluationCount`) with a gitignored `.totem/cache/rule-metrics.json` lifetime. ADR-091 § 65 was amended to specify `.totem/verification-outcomes.json` instead — separate filename for the new committable verification state, separate module name (`verification-outcomes.ts`) for the new schemas + persistence layer.

## 1.23.0

### Minor Changes

- 94ea4a8: **Pack v0.1 alpha pilot: `@mmnto/pack-rust-architecture` lift + ADR-091/097 substrate completion (#1773)**

  First non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate (#1768/#1769/#1770 in 1.22.0). Validates the substrate end-to-end by registering Rust as a language extension and dispatching ast-grep rules against `.rs` source.

  **`@mmnto/pack-rust-architecture@1.23.0`** — new package (`private: true`)
  - 8 baseline lessons sourced from `mmnto-ai/liquid-city#134` (slice-6 vehicle-agent + dispersion review cycle, lc-Claude attribution preserved)
  - Synchronous CJS `register.cjs` wires Rust into both engine paths: `api.registerLanguage('.rs', 'rust', wasmLoader)` for the web-tree-sitter side and `napi.registerDynamicLanguage({ rust })` for the @ast-grep/napi side (v0.1 side-channel, see `@mmnto/totem#1774`)
  - Bundled `tree-sitter-rust.wasm` (1.1 MB) sourced from `@vscode/tree-sitter-wasm@0.3.1` (MIT, Microsoft) via `prepare`-time copy
  - `compiled-rules.json` ships one tracer-bullet seed rule (`lesson-8cefba95`, Bevy hot-path `Local<Vec<T>>` per-tick allocation) — full LLM-compile of the 8-lesson set deferred to a focused follow-up since γ (per-language `KIND_ALLOW_LIST`, #1655) is needed before LLM-compile of Rust patterns avoids TS-grammar hallucinations
  - Runtime integration tests boot the pack via `loadInstalledPacks({ inMemoryPacks })` and verify the seed rule fires on `.rs` source through the full substrate path

  **`@mmnto/totem` — #1654 fix: thread target Lang through the compile-time pattern validator**

  Pre-#1654, `validateAstGrepPattern` always parsed under `Lang.Tsx` regardless of the rule's `fileGlobs`, and `inferBadExampleExts` (smoke gate) used a TS/JS-only regex that silently fell back to the default set for non-TS rules. A Rust pattern would either false-pass under TSX (the `ResMut<TacticalState>` exhibit) or false-fail with a TSX-parser error.
  - `validateAstGrepPattern(pattern, fileGlobs?)` now resolves the target Lang via `resolveAstGrepLangs(fileGlobs)` and accepts the pattern when any one Lang accepts it. Falls back to `Lang.Tsx` when fileGlobs is empty or no glob carries a registered extension (preserves legacy unscoped-rule semantics).
  - `inferBadExampleExts` extracts any trailing extension from `fileGlobs` (not just TS/JS); runtime's `extensionToLang` filters out unmapped extensions inside `matchAstGrepPattern` so unmapped extensions cleanly return zero matches without parsing under the wrong grammar.
  - New `resolveAstGrepLangs` helper exported alongside `extensionToLang` from `ast-grep-query.ts`.
  - 6 new regression tests covering the LC false-positive exhibit and the TS-fallback preservation invariant.

  **Substrate-extension follow-up filed as #1774 (tier-2, investigation)**: lift the napi-side language registration into `PackRegistrationAPI.registerNapiLanguage` once N≥2 pack consumers exist. PR-B's side-channel pattern in `register.cjs` is the time-boxed precedent that gathers design data; the side-channel is documented as visible debt in the pack's README.

### Patch Changes

- d4e2eb1: **Fix #1776 wiggle — remove `@mmnto/totem` peerDep from `@mmnto/pack-rust-architecture`.**

  The first Version Packages auto-cut after PR #1775 pre-empted `1.22.0 → 2.0.0` instead of `1.22.0 → 1.23.0` despite all changesets being declared `minor`. Root cause: `@mmnto/pack-rust-architecture` declared `peerDependencies['@mmnto/totem']: ^1.22.0`, which combined with the changesets `fixed` group creates a circular constraint — the pack's peerDep range update on a totem minor bump triggers a MAJOR cascade per the changesets peerDep-update policy, and the cascade lifts every fixed-group member to a major bump.

  Fix mirrors the pattern in `@mmnto/pack-agent-security`: fixed-group packs do not declare `@mmnto/totem` as a peerDep — version harmony is guaranteed at publish time by the fixed group itself, not by peerDep range pinning. `@ast-grep/napi` (external, not in the fixed group) remains a peerDep as expected.

  Test `structure.test.ts` updated to assert the exact-key equality of `peerDependencies` so a regression in this rule is caught at unit-test time, not at next Version Packages auto-cut.

  No runtime behavior change. Pack still registers Rust into both engine paths via `register.cjs`.

All notable changes to `@mmnto/pack-rust-architecture` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-30

### Added

Initial release. 8 baseline architectural lessons for Rust + Bevy ECS consumers, sourced from `mmnto-ai/liquid-city` PR #134's slice-6 review cycle (vehicle-agent contact + dispersion implementation) plus 2 hand-authored seeds.

**Numeric safety (3 lessons):**

- `lesson-2d305b47` — `linvel.norm()` overflow to `f32::INFINITY` despite finite vector components; `is_finite()` guard + regression test pattern.
- `lesson-d020574f` — Float stride loop-bound DoS: validate finiteness, then cast to integer, then `saturating_mul` against `MAX_TOTAL_CELLS`.
- `lesson-c79543ba` — Tuning constants with runtime `assert!` guards need matching `const _: () = assert!(...)` at the declaration site for compile-time enforcement.

**Compile-time discipline (1 lesson):**

- `lesson-de45dee2` — Float arithmetic methods (`.floor()`, `.ceil()`, `.sqrt()`, `.powf()`, `.powi()`, `.abs()`, trig/log family) are unavailable in Rust const-eval (1.95). Const-assert rewrites use direct ops + cast (divide-then-cast, not pre-cast).

**Bevy ECS (3 lessons):**

- `lesson-8cefba95` — Bevy hot-path: `Local<Vec<T>>` system parameter with `.clear()` + `.extend()` instead of per-tick `query.iter().collect()`.
- `lesson-b25f0c4a` — Bevy schedule `.before/.after` edges must encode explicit producer-consumer or wake-gate contracts; companion rule on Bevy 0.14's `.chain()` ~20-system tuple-trait limit.
- `lesson-691fbb72` — Determinism tests must use 2+ archetypes for sort-by-`Entity` ID to be load-bearing; single-archetype fixtures pass vacuously.

**Testing discipline (1 lesson):**

- `lesson-9bc7ac4a` — Test world builders must install resources / map data in the same order as production; extract a shared base builder so production and test paths share the sequenced setup.

### Sources

- 6 lessons via `totem review-learn` extraction on `mmnto-ai/liquid-city#134` (Sonnet 4.6, 8.7k in / 1.3k out tokens).
- 2 lessons hand-authored to seed Bucket B1 + B2 territory per `audits/internal/2026-04-30-ecosystem-churn-diagnosis.md` § 4 dev-Gemini's three-bucket diagnosis.

### Notes

- `private: true` for the initial release, consistent with `@mmnto/pack-agent-security` precedent.
- `compiled-rules.json` not included in this draft; regenerated by the totem CLI in the package workspace once the lessons are at `packages/pack-rust-architecture/lessons/`.
- ADR-097 Stage 1 pilot. Stage 2 cycles will harvest from additional consumers (totem itself, future Rust + Bevy adopters) for v0.2.
