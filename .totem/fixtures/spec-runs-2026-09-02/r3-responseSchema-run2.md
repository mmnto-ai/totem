### Problem Statement
The `totem spec` command incorrectly permits unanchored free-text topics to pass through similarity-only searches without verification, generating empty or useless draft artifacts that satisfy the weak pre-commit gate. This task requires enforcing strict grounding checks, rejecting unanchored specs failing retrieval floor limits, recording anchor metadata and retrieval scores, and upgrading the pre-commit gate to validate non-empty, anchored specs.

### Architectural Context
Based on the 2026-08-30 strategy ruling, 'totem spec writes a contract only when it is grounded; its output is one retrieval input, never the contract'. We must enforce that unanchored free-text runs without any retrieval hit above the floor exit loudly without writing artifacts. `--from <record>` binds the hand-authored file by recording its SHA-256 and path. The pre-commit gate must be upgraded from merely checking 'a spec ran' to checking 'a spec was anchored (issue or record) and has content (> 100 bytes of non-whitespace)'. This coordinates directly with hooks and run artifact structures.

### Files to Examine
packages/cli/src/commands/spec.ts — contains command entrypoint, resolver logic, and prompting pipeline.
packages/core/src/artifacts/grounding.ts — contains grounding interfaces, grounding bundle schema, and provenance types.
packages/cli/src/utils.ts — contains buildRetrievalGroundingBundle and utility methods for grounding construction.
packages/cli/src/commands/install-hooks.ts — contains pre-commit hook installer script template and verification logic.
packages/cli/src/commands/install-hooks.test.ts — contains hook and spec evidence testing suites.

### Technical Approach & Contracts
1. **Artifact Schema Upgrade**: In `packages/core/src/artifacts/grounding.ts`, add a first-class `anchor` property: `{ kind: 'issue' | 'record' | 'free-text'; ref: string; sha256?: string }`. Modify the individual grounding item interface to include optional `score: number` so that retrieval floors can be evaluated and disclosed.
2. **Grounding Resolver Changes**: When executing `totem spec`, resolve the input. If the input is free-text and `--from` is omitted, query the vector DB and evaluate scores. If no item's score exceeds the threshold (the 'floor', sourced from configuration), throw a clean CLI exit error disclosing the floor threshold and source, and skip creating any artifact files. If `--from <path>` is provided, read the file, compute its SHA-256 hash, write the anchor with kind='record', and bypass model drafting to bind the hand-authored file as the spec of record.
3. **Pre-commit Gate Upgrade**: In `packages/cli/src/commands/install-hooks.ts` (which templates the pre-commit hook), update the JSON-parsing step of the latest spec run. Ensure it verifies: `grounding.anchor.kind` is 'issue' or 'record', and `output.content` stripped of whitespace is > 100 bytes. Reject empty or unanchored artifacts with a clean exit status.

### Edge Cases & Traps
1. **Whitespace-Only Artifacts**: Some runs might complete with whitespace-only content (e.g. '\n') but record high output token counts due to LLM overhead. We must strictly measure length on trimmed string content rather than raw token counts.
2. **Missing Grounding Scores**: Legacy run artifacts in checkout stores do not have 'score' or 'anchor' properties. The upgraded parser must handle these properties gracefully as optional or default to 'free-text' and score '0' to avoid crashing on old runs.
3. **Silent Failures**: Ensure that a refusal due to failing the floor limit exits with a non-zero code and outputs to stderr, satisfying the 'silent-to-loud' paradigm.

### Implementation Tasks
- [ ] **Task 1: Update Grounding Artifact Types and Schemas**
  Update `packages/core/src/artifacts/grounding.ts` to support the new `anchor` object and add `score` to the grounding items.
  > TEST DIRECTIVE: Before implementing, write a failing test named `rejectsLegacyMetadataWithoutAnchor` to verify fallback handling.
  Modify types -> update validation schemas -> verify build

- [ ] **Task 2: Implement Retrieval Floor Checking and Refusal in Spec Command**
  Modify `packages/cli/src/commands/spec.ts` to verify similarity scores against the configured floor. Refuse unanchored free-text if all scores are below the floor, printing the floor and source.
  > TOTEM INVARIANT (unanchored refusal): A free-text topic that resolves to no anchor and no knowledge hit above floor must exit non-zero and write NO artifact.
  > TEST DIRECTIVE: Before implementing, write a failing test named `refusesUnanchoredSpecBelowFloor` that triggers this clean failure.
  Modify spec.ts -> add threshold validation -> prevent artifact creation -> test and lint

- [ ] **Task 3: Support Hand-Authored Records via `--from`**
  Update the command option parser to accept `--from <record-path>`. Calculate the SHA-256 of the record file, fill the `anchor` object with kind 'record' and the SHA-256, and skip LLM synthesis.
  Modify spec.ts command options -> implement SHA-256 calculation -> bypass LLM -> update tests

- [ ] **Task 4: Upgrade the Strict Pre-commit Gate**
  Update the pre-commit template hook generator in `packages/cli/src/commands/install-hooks.ts` to inspect `grounding.anchor.kind` and assert `output.content` is non-empty (> 100 bytes of trimmed content).
  > TEST DIRECTIVE: Before implementing, write a failing test named `preCommitRejectsEmptyOrUnanchoredArtifact` in `packages/cli/src/commands/install-hooks.test.ts`.
  Modify pre-commit template script -> parse JSON fields -> implement validator checks -> verify test coverage -> lint

### Execution Flow (structural constraint)
digraph workflow {
  spec -> write_test -> verify_fails -> implement -> verify_passes -> lint -> next_task
  verify_fails -> implement [label="RED only"]
  verify_passes -> lint [label="GREEN required"]
  lint -> next_task [label="0 violations"]
  lint -> implement [label="violations found — fix first"]
}

### Verification (MANDATORY — do not skip)
1. Run `totem lint` to ensure zero code formatting or structural violations exist across the modified workspace files.
2. Run `totem review` on the resulting git diff to verify hook structure and schemas match the strategic directives.
3. Execute the newly added hook checks and spec-resolution tests to ensure complete execution flow verification.

### Test Plan
1. **Grounding Serialization Test**: Verify that running `totem spec` with a valid issue or a valid record properly serializes `grounding.anchor` and individual item `score` fields.
2. **Floor Limit Failure Test**: Mock vector DB results to return scores below the configured floor. Assert `totem spec` exits with code 1, prints the threshold and its configuration source, and does not write any JSON artifact to `.totem/artifacts/runs/`.
3. **Gate Verification Test**: In `install-hooks.test.ts`, feed the hook validator with three run JSONs: one empty spec (should fail), one unanchored spec (should fail), and one anchored issue spec with real content (should pass). Confirm the exit codes align with gate requirements.
