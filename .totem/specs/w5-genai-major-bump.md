# W5 — @google/genai 1.44.0 → 2.6.0 cohort major bump

**Spec type:** preflight (no GitHub issue; wave-plan item, internal tracking)
**Source:** W5 of the cohort dep-refresh wave plan (memory FIRST MOVE block, claude-0067+)
**Drafted:** 2026-05-24 (claude-0071)
**Author:** totem-claude
**Disposition lineage:** `mmnto-ai/totem-strategy#404` (Proposal 286 — option (c) graceful-degradation; closes prereq `mmnto-ai/totem#2018`)
**Empirical probe lineage:** local 2.6.0 dry-run probe at `2026-05-24T2207Z` (API-STABLE, 47/47 tests green)

This document was authored manually (not via `totem spec <N>`) because W5 has no GitHub issue. Phase 1 context-gathering was done via `npm view`, the 2.6.0 probe, and grep against the workspace.

## Phase 1 summary

### What changed in @google/genai 1.x → 2.x

Verified against installed `node_modules/@google/genai/dist/genai.d.ts` (after probe install) and `npm view` deltas across 1.44.0, 2.0.0, 2.6.0:

**No change:**

- Transitive deps (`google-auth-library@^10.3.0`, `p-retry@^4.6.2`, `protobufjs@^7.5.4`, `ws@^8.18.0` — identical 1.44 → 2.6).
- Node engine constraint (`>=20.0.0` — we already require `>=24` from W3, so no pressure).
- Public API surface for the 4 entry points we use:
  - `new GoogleGenAI({ apiKey })`
  - `ai.models.embedContent({ model, contents, config: { taskType, outputDimensionality } })` → `response.embeddings[].values`
  - `ai.models.generateContent({ model, contents, config: { maxOutputTokens, temperature?, systemInstruction? } })` → `response.text`, `response.usageMetadata.{promptTokenCount, candidatesTokenCount}`, `response.candidates[0].finishReason`

**Change:**

1. **NEW `peerDependency: @modelcontextprotocol/sdk@^1.25.2`** — absent in 1.x. Benign for our root + cli devDep consumption (pnpm did not strict-warn during probe install); **release-note flag for downstream pack consumers** with strict peer enforcement.
2. **Major version bump itself** — SemVer signal of intent-to-break; we verified empirically that none of the 4 surfaces we use broke.

### Files in scope (verified via grep)

| File                                   | Change                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                  | `devDependencies['@google/genai']: ^1.44.0 → ^2.6.0`                                                                 |
| `packages/cli/package.json`            | `devDependencies['@google/genai']: ^1.44.0 → ^2.6.0`; narrow peerDep envelope from `>=1.0.0` to `>=2.0.0` per Q1 (c) |
| `packages/core/package.json`           | Narrow peerDep envelope from `>=1.0.0` to `>=2.0.0` per Q1 (c)                                                       |
| `services/compile-worker/package.json` | `dependencies['@google/genai']: ^1.0.0 → ^2.6.0`                                                                     |
| `pnpm-lock.yaml`                       | Regenerate (`pnpm install` produces deterministic diff after package.json bumps)                                     |

**Anti-scope (not modified):**

- The 2 SDK call sites (`packages/core/src/embedders/gemini-embedder.ts:91,109`, `packages/cli/src/orchestrators/gemini-orchestrator.ts:66,77`) — probe-verified to type-check + test-pass against 2.6.0's `.d.ts` unchanged.
- The graceful-degradation impl of Proposal 286 — that's a separate ticket/PR. W5 ships against the post-disposition POSTURE (optional-peer dep posture preserved); the (c) impl (keyword fallback in `totem search`) is bookkept separately.
- Other cohort packages (`@mmnto/{mcp, pack-rust-architecture, pack-agent-security}`) — none import `@google/genai`.

### Knowledge / lesson signals

- `feedback_contract_claims_must_anchor_to_canonical_code` — every spec claim must grep against actual config. Probe verified the 4 API surfaces in-place.
- `feedback_oidc_publish_workflow_pattern` — publish path; the v11 pnpm pack + npm publish split (W4) is independent of this bump.
- `feedback_test_invariant_check_before_fix` — anchors the mock-vs-real divergence risk class. Strategy-claude ratified skip-smoke on the basis that the standing recompile cycle's natural surface catches what matters.
- `feedback_repo_qualify_refs` — applies to this spec's cross-repo references (`mmnto-ai/totem-strategy#404`, `mmnto-ai/totem#2018`) and to any prose downstream (changesets, PR body).

### Empirical baseline (verified during probe `2026-05-24T2207Z`)

- Installed 2.6.0 via `pnpm add -D -w @google/genai@2.6.0` in a worktree; 387 sub-packages resolved cleanly; no strict peer-dep warnings.
- `pnpm --filter @mmnto/totem build` — zero TS errors.
- `pnpm --filter @mmnto/cli build` — zero TS errors.
- `gemini-embedder.test.ts` — 15/15 pass.
- `gemini-orchestrator.test.ts` — 12/12 pass.
- `conformance.test.ts` — 20/20 pass.
- `node_modules/@google/genai/dist/genai.d.ts` and `dist/node/node.d.ts` — confirmed all 4 API surfaces present and signature-compatible.

---

## Implementation Design (W5)

### Scope (2 sentences)

Bump `@google/genai` from `^1.44.0` to `^2.6.0` across the workspace (root devDep, `packages/cli` devDep, `services/compile-worker` dep), preserving the existing optional-peer dep posture in `@mmnto/totem` and `@mmnto/cli` per the Proposal `mmnto-ai/totem-strategy#404` disposition. This is a pure version-constraint edit + lockfile regen; the (c) graceful-degradation impl in `totem search` is tracked as a separate follow-on against `mmnto-ai/totem#2018` and is NOT in W5 scope.

### Data model deltas

1. **`devDependencies['@google/genai']` (root + `packages/cli`)** — pin value changes.
   - **Was:** `^1.44.0`
   - **Will be:** `^2.6.0`
   - **Who writes:** human (this PR)
   - **Who reads:** pnpm at install time; vitest at test time (when SDK is imported); local dev workflows
   - **Invariant:** must match the major declared in peerDeps (if peerDep envelope is widened — see open Q1)

2. **`dependencies['@google/genai']` (`services/compile-worker`)** — pin value changes.
   - **Was:** `^1.0.0`
   - **Will be:** `^2.6.0`
   - **Who writes:** human (this PR)
   - **Who reads:** pnpm at install time for the compile-worker service
   - **Invariant:** compile-worker is a service (not published as a pack); no peer-dep coordination needed downstream

3. **`peerDependencies['@google/genai']` (`packages/core`, `packages/cli`)** — narrowed.
   - **Was:** `>=1.0.0` (optional)
   - **Will be:** `>=2.0.0` (optional)
   - **Who writes:** human (this PR)
   - **Who reads:** pnpm at install time on downstream consumers
   - **Invariant:** advertised compat envelope must match the major we test + build against. After W5, our build runs against 2.x's `.d.ts` — claiming 1.x compat would be false advertising the moment a future change relies on a 2.x-only field.

4. **`pnpm-lock.yaml`** — regenerated.
   - **Was:** locked at `@google/genai@1.44.0`
   - **Will be:** locked at `@google/genai@2.6.0` + new transitive `@modelcontextprotocol/sdk@^1.25.2` if pnpm resolves it (it may not, since the peerDep is unmet locally and optional from our consumption angle)
   - **Who writes:** pnpm (automatic via `pnpm install` after package.json edits)

### State lifecycle

- Version pins are persistent; mutated only at major bumps (this is one).
- Lockfile is regenerated on every install; the diff lands in the W5 PR.
- No ephemeral state; no cross-lifecycle hazards.

### Failure modes

| Failure                                                                                                         | Category | Agent-facing surface                                                                    | Recovery                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 2.x runtime wire-format quirk not visible from `.d.ts` (e.g., response field renamed at JSON layer)             | runtime  | First post-merge `totem sync` / `totem lesson compile` (Gemini route) fails at API call | Hot-fix PR — patch the call site; risk class anchored by `feedback_test_invariant_check_before_fix` |
| Downstream pack consumer with strict peer enforcement breaks on new `@modelcontextprotocol/sdk@^1.25.2` peerDep | install  | `ERR_PNPM_PEER_DEP_ISSUES` on consumer's install                                        | Release-note + suggest consumer either provides MCP SDK or sets `auto-install-peers=true`           |
| Lockfile churn larger than expected (new transitive tree under 2.x sub-deps)                                    | review   | PR diff is noisy; reviewers can't audit                                                 | Standard for major bumps; flag in PR body that lockfile delta is mechanical                         |
| `@google/genai@2.6.0` removes a 1.x export we don't directly use but a transitive dep does                      | install  | TS error from a transitive type ref                                                     | Probe-verified: no such error in our build. Re-verify in CI.                                        |
| Test mocks at `vi.mock('@google/genai', ...)` shadow a 2.x type-only change                                     | runtime  | Production-only failure that tests don't catch                                          | Acknowledged risk; ratified skip-smoke per strategy-claude `T2024Z` reply                           |

Per Tenet 4 (Fail Loud): runtime wire-format quirks are the explicit risk class we're accepting. The recompile cycle's natural Gemini-route invocation is the smoke surface; no manual smoke ceremony.

### Invariants to lock in via tests

Pre-push / CI gates (this is a config bump, not new code surface):

1. **`pnpm install` succeeds** on Node 24 from clean checkout; lockfile resolves `@google/genai@2.6.0`.
2. **`pnpm --filter @mmnto/totem build` + `pnpm --filter @mmnto/cli build` pass** with zero TS errors against 2.6.0's `.d.ts`.
3. **`gemini-embedder.test.ts` (15/15) + `gemini-orchestrator.test.ts` (12/12) + `conformance.test.ts` (20/20)** all green.
4. **Full cli + core suites green** — no transitive regression.
5. **`xrepo-qualify-refs` lint passes** on the changeset prose + PR body (see open Q3 for cohort-coord scope).

### Open questions

1. **PeerDep envelope: keep `>=1.0.0`, widen to `>=1.0.0 || >=2.0.0`, or narrow to `>=2.0.0`?**
   - **Options:**
     - (a) **Keep `>=1.0.0`** — broadest compat; downstream consumers on 1.x are unaffected
     - (b) **Widen to `>=1.0.0 || >=2.0.0`** — explicit dual-major; signals intent to accept either while cohort migrates
     - (c) **Narrow to `>=2.0.0`** — drops 1.x compat; advertised envelope matches what we test against
   - **Decision:** (c) — narrow to `>=2.0.0`. After W5 ships, our test + tsc build runs against 2.x's `.d.ts`; the 1.x compat claim becomes false advertising the moment a future change relies on a 2.x-only field. Per grep, zero current cohort consumers import `@google/genai` directly — no one breaks on the narrow, so there's nothing to gracefully transition. Optional-peer posture means the constraint is advisory (consumers providing 1.x get a warning, not an install error). Matches the W3 engine-strict progressive-floor discipline where we narrowed `>=22` → `>=24` cleanly once cohort safety was confirmed.

2. **Release-note treatment of the new `@modelcontextprotocol/sdk@^1.25.2` peerDep?**
   - **Options:**
     - (a) **One-line flag in cohort CHANGELOG entries** — simplest; downstream sees it on `pnpm view` / package detail
     - (b) **Separate advisory dispatch to cohort consumers** (LC, status-Go, etc.) before W5 merges — matches the W4 cross-stream heads-up pattern
     - (c) **Both (a) + (b)**
   - **Decision:** (a) only. Unlike W4 (which forced pnpm major + lockfile-format compat questions for everyone), this bump is invisible to consumers who don't directly import `@google/genai`. Cohort consumers who DO import it (none currently — grep-verified) would already be on optional-peer posture.

3. **Cohort-coord dispatch to LC / status-Go / arhgap11?**
   - **Options:**
     - (a) **None** — these consumers don't import `@google/genai`; W5 is invisible to them
     - (b) **Heads-up dispatch** matching W4's pattern (`2026-05-24T0002Z-*-w4-pnpm-11-cohort-heads-up.md`) — proactive comms even when impact is nil
   - **Decision:** (a). W4 needed the dispatch because pnpm bump forced lockfile-format compat questions cohort-wide. W5 has no such forcing function. If we discover post-merge that a cohort consumer hits a peer-dep issue, file a follow-up; don't over-broadcast.

### Open question — not for the design doc, but for the user

The W5 work is Mechanical per the preflight rubric (Architectural decision was settled in Proposal `mmnto-ai/totem-strategy#404`). Implementation surface estimate: ~4 files (3 package.json + lockfile); ~30 min coding + lockfile regen + CI verification; minimal risk per probe verdict.

The user's call:

- **Approve the design as-is and queue implementation** (the lean) — single PR; small; ships against the post-disposition posture; the (c) impl in `totem search` follows in a separate ticket.
- **Push back on any open question above** (most likely candidates: peerDep envelope width? cohort-coord dispatch?).
- **Wait for `mmnto-ai/totem-strategy#404` to merge before implementing** — strict reading of strategy-claude's sequence step 5. The looser reading is "design + queue now; merge implementation after Proposal lands."
