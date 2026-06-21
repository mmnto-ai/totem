---
'@mmnto/totem': minor
---

Gate-1 miner slice 5c — the certifying-run orchestrator (ADR-111, #2189 item 1), bundling the held 5c-i release.

Completes the Convergent Spine Gate-1 miner: `totem spine windtunnel run --phase certifying` now drives the full pipeline end-to-end on the frozen train slice — fetch→extract→classify (live 5b LLM adapters in record/replay decorators) → compile → the 5c-i real-engine firing path → score → legitimacy projection → persist + a cert-run report — replayable zero-LLM, zero-network in CI.

- **fold-D dedup**: `buildFirings` collapses same-`labelId` matches to one logical firing (raw matches retained as `evidence`); `assertUniqueFiringLabels` demotes to a post-dedup invariant. Verdict-safe under the 1.0 precision floor.
- **fold-B/C persist**: `projectLegitimacy` stamps survivors PASS-only from their own per-rule control results (binding-4: `unverified` flips only when both controls pass); `buildCertifiedRulesFile` parses before write so a half-stamp fails loud pre-disk. PASS-survivors land in the gate-1 cert output (never the live corpus — strategy#516 promotes); non-terminals write a cert-run report only (§6 L3).
- **L2**: the lock carries `controls.integrity.llmReplaySha` — the external expected-hash for the frozen `llm-replay.v1` fixture, beside `fixtureSha`.
- **Orchestrator**: `buildCertifyingCorpus` composes the shipped extract/classify/compile stages; binding-2 excludes Stage-4 out-of-scope (archived) rules from the scored set; fold-I asserts held-out-fetch-count is 0 (FM-h) and emits the miner ledgers.
- **record/replay**: `spine windtunnel record` (A2 — separate, fail-safe) freezes the `llm-replay.v1` fixture + review content and prints the integrity hash; the run path replays them zero-network. **fold-K** proves the replay path makes zero outgoing TCP/`fetch` calls and that a wrong expected-hash fails the integrity gate loud.

Includes the held 5c-i real-engine firing path (`buildFirings` replacing the mock; per-rule control results C1, the `filesTouchedInWindow` exposure floor C2, fold-F archived-assert, fold-H OQ4 matrix), which shipped inert pending this slice.
