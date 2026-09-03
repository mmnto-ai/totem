### Problem Statement
The `totem spec` command erroneously drafts specs on unanchored free-text topics and records them as valid grounding runs, allowing empty or hallucinated drafts to bypass the pre-commit gate. The pre-commit gate must be upgraded to strictly require anchored runs (either an issue or a hand-authored design record) with non-empty content, and unanchored runs falling below similarity thresholds must be refused without minting artifacts.

### Architectural Context
The codebase implements git pre-commit verification via `tools/pre-commit` which is rendered from `packages/cli/src/commands/install-hooks.ts`. Past spec runs are saved as JSON artifacts in `.totem/artifacts/runs/`. To establish a strict quality gate, we must explicitly record the anchor type and retrieval score inside the grounding bundle schema, refusing unanchored topics failing to meet configured similarity floors.

### Files to Examine
1. `packages/cli/src/commands/spec.ts` — Core command resolving input topics, executing similarity searches, and producing the grounding bundle and output artifacts.
2. `packages/core/src/artifacts/grounding.ts` — Definition of types and schemas representing grounding bundles and provenance.
3. `packages/cli/src/utils.ts` — Contains helper functions like `buildRetrievalGroundingBundle` that build grounding records.
4. `packages/cli/src/commands/install-hooks.ts` — Generates and writes the `tools/pre-commit` hook that reads spec artifacts.
5. `packages/cli/src/commands/install-hooks.test.ts` — Spec evidence readers test suite verifying hook execution and validation logic.

### Technical Approach & Contracts
1. **Anchor Field Contract**: Update the grounding bundle schema (`GroundingBundle`) in `packages/core/src/artifacts/grounding.ts` to expose an `anchor` field:
   ```typescript
   export interface GroundingAnchor {
     kind: 'issue' | 'record' | 'free-text';
     ref: string;
     sha256?: string;
   }
   ```
   Each item inside the grounding bundle must also include its similarity `score: number`.
2. **Hand-Authored Record Anchoring**: Add `--from <path>` to `totem spec`. Read and compute the SHA-256 hash of the record file at `<path>`. Bind this file with anchor `kind: "record"` and save both `ref: path` and `sha256` in the artifact. Do not attempt to run LLM drafts over hand-authored records; instead, bind the record content and save the artifact.
3. **Floor Refusal Enforcement**: For unanchored free-text topics, run similarity retrieval. If the highest score is below the configured similarity floor (e.g. 0.7, fetched from Totem config), the command must exit with a non-zero code, print the floor threshold and its configuration source, and write no run artifact.
4. **Upgraded Hook Gate**: Update the pre-commit hook template in `packages/cli/src/commands/install-hooks.ts` to parse the newest JSON spec artifact. Assert that:
   - `grounding.anchor.kind` is in `['issue', 'record']`.
   - `output.content` is a string with a trimmed size greater than 150 characters.

### Edge Cases & Traps
1. **Legacy Run Artifacts**: Legacy run artifacts in the local run store will not contain `grounding.anchor`. The gate's JSON parser must use defensive optional chaining (e.g., `artifact?.grounding?.anchor?.kind`) to prevent runtime crashes, safely treating missing anchors as unanchored (rejected).
2. **Refusal Hallucinations**: Some LLMs generate a polite refusal message exceeding 150 characters when failing on topics. Validating only output length is insufficient; the primary gate constraint must enforce `anchor.kind ∈ {issue, record}`.
3. **Race Conditions**: Parallel specs can cause timestamp collisions. Always sort run artifacts by modification time/creation time deterministically when selecting the newest artifact.

### Implementation Tasks
- [ ] **Task 1: Extend Grounding Schema with Anchors and Scores**
  - Modify `packages/core/src/artifacts/grounding.ts` and `packages/cli/src/utils.ts` to support the new `anchor` object and include `score: number` inside grounding items.
  - TEST DIRECTIVE: Before implementing, write a failing test named `rejectsLegacyArtifactWithoutAnchorField` verifying that missing anchor properties fail strict validation constraints.
  - write test -> verify fails -> implement -> verify passes -> lint

- [ ] **Task 2: Support Hand-Authored Records via `--from`**
  - Update `packages/cli/src/commands/spec.ts` to parse `--from <path>` parameters.
  - Read the targeted file, compute its SHA-256 hash, and populate the grounding anchor metadata with `kind: "record"`.
  - TEST DIRECTIVE: Before implementing, write a failing test named `correctlyBindsHandAuthoredRecordAnchor` that asserts a file passed via `--from` is correctly hashed and anchored.
  - write test -> verify fails -> implement -> verify passes -> lint

- [ ] **Task 3: Refuse Unanchored Similarity Runs Below Floor**
  - Update similarity threshold evaluation in `packages/cli/src/commands/spec.ts` for free-text inputs.
  - If no scores meet the floor, print the floor value, its configuration source, and exit non-zero without writing an artifact.
  - TEST DIRECTIVE: Before implementing, write a failing test named `refusesUnanchoredTopicBelowFloorWithoutArtifact` that triggers on low similarity and validates the error output format.
  - write test -> verify fails -> implement -> verify passes -> lint

- [ ] **Task 4: Upgrade Pre-Commit Hook Generator Gate**
  - Update hook generation template inside `packages/cli/src/commands/install-hooks.ts` to parse the JSON artifact and assert valid anchor kinds along with a content length > 150 characters.
  - TEST DIRECTIVE: Before implementing, write a failing test named `preCommitGateRejectsUnanchoredAndEmptySpecs` in `packages/cli/src/commands/install-hooks.test.ts` to assert that unanchored, empty, or legacy drafts fail the verification gate.
  - write test -> verify fails -> implement -> verify passes -> lint

### Execution Flow (structural constraint)
digraph workflow {
  spec -> write_test -> verify_fails -> implement -> verify_passes -> lint -> next_task
  verify_fails -> implement [label="RED only"]
  verify_passes -> lint [label="GREEN required"]
  lint -> next_task [label="0 violations"]
  lint -> implement [label="violations found — fix first"]
}

### Verification (MANDATORY — do not skip)
Every implementation MUST end with these steps:
1. `totem lint` — deterministic rule check (zero LLM, ~2s). Fixes any violations.
2. `totem review` — supplementary AI lanes over the diff (~18s, advisory). Address critical findings; your team's review discipline decides the review of record.
3. If using MCP, call `verify_execution` to confirm compliance before declaring the task done.

### Test Plan
1. **Spec Command Grounding**: Write unit tests validating that `totem spec` successfully hashes and anchors hand-authored files under `--from`, and safely errors out on free-text inputs that fall below similarity score thresholds.
2. **Hook Parity Validation**: Write unit and integration tests verifying both the JS/TS verification logic and the generated shell script hook properly block commit sequences if the latest artifact is unanchored or empty.
3. **Fallback Resiliency**: Ensure existing test runner suites pass when analyzing legacy run artifacts that lack the new metadata structure, treating them safely as unanchored.
