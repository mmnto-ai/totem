---
'@mmnto/cli': patch
---

chore(deps): bump @google/genai 1.44.0 -> 2.6.0 (W5 cohort dep wave)

Lifts the workspace pin on `@google/genai` from `^1.44.0` to `^2.6.0`, narrows the optional peer envelope in `@mmnto/totem` and `@mmnto/cli` from `>=1.0.0` to `>=2.0.0` to match the major we now test and build against, and bumps the `services/compile-worker` runtime dep in lockstep. Probe-verified API-stable: the four SDK surfaces we use (`new GoogleGenAI({ apiKey })`, `ai.models.embedContent(...)`, `ai.models.generateContent(...)`, plus the `response.text` / `response.usageMetadata` / `response.candidates` read paths) compile and pass tests against 2.6.0's `.d.ts` without code edits.

## What ships

| File                                   | Change                                                        |
| -------------------------------------- | ------------------------------------------------------------- |
| `package.json` (root devDep)           | `@google/genai`: `^1.44.0` -> `^2.6.0`                        |
| `packages/cli/package.json` (devDep)   | `@google/genai`: `^1.44.0` -> `^2.6.0`                        |
| `packages/cli/package.json` (peerDep)  | `@google/genai`: `>=1.0.0` -> `>=2.0.0` (optional, unchanged) |
| `packages/core/package.json` (peerDep) | `@google/genai`: `>=1.0.0` -> `>=2.0.0` (optional, unchanged) |
| `services/compile-worker/package.json` | `@google/genai`: `^1.0.0` -> `^2.6.0`                         |
| `pnpm-lock.yaml`                       | Regenerated; 2.6.0 resolves cleanly, no peer warnings         |

## Empirical baseline (dry-run probe `2026-05-24T2207Z`)

- `pnpm install` on Node 24 from clean checkout — succeeded; 387 sub-packages resolved; no strict peer warnings emitted.
- `pnpm --filter @mmnto/totem build` (tsc) — zero TS errors against 2.6.0's `.d.ts`.
- `pnpm --filter @mmnto/cli build` (tsc) — zero TS errors against 2.6.0's `.d.ts`.
- `src/embedders/gemini-embedder.test.ts` — 15 / 15 pass.
- `src/orchestrators/gemini-orchestrator.test.ts` — 12 / 12 pass.
- `src/orchestrators/conformance.test.ts` — 20 / 20 pass.

The four API surfaces we use (`new GoogleGenAI({ apiKey })` at `packages/core/src/embedders/gemini-embedder.ts:91` and `packages/cli/src/orchestrators/gemini-orchestrator.ts:66`; `ai.models.embedContent(...)` at `gemini-embedder.ts:109`; `ai.models.generateContent(...)` at `gemini-orchestrator.ts:77`; plus the `response.embeddings[].values` / `response.text` / `response.usageMetadata.{promptTokenCount, candidatesTokenCount}` / `response.candidates[0].finishReason` read paths) are all present in `node_modules/@google/genai@2.6.0/dist/genai.d.ts` with signature-compatible shapes.

## Why narrow peerDep `>=1.0.0` -> `>=2.0.0`

After this PR, the workspace tests + tsc build run against 2.x's `.d.ts`; the 1.x compat claim would become false advertising the moment a future change relies on a 2.x-only field or shape. Per grep, zero current cohort consumers import `@google/genai` directly, so nothing breaks on the narrow. The optional-peer posture (`peerDependenciesMeta.@google/genai.optional: true`) means consumers providing a 1.x version get a pnpm warning, not an install error. Matches the W3 engine-strict pattern where the advertised envelope narrowed cleanly once cohort safety was confirmed empirically.

## Downstream peerDep flag

`@google/genai@2.0.0` introduced a new `peerDependency` on `@modelcontextprotocol/sdk@^1.25.2` that was absent in 1.x. Benign for our consumption (root + cli devDep; pnpm did not strict-warn on install), but downstream pack consumers with strict peer enforcement who transitively pull `@google/genai` may see a peer warning unless they also provide an MCP SDK. Documented here so consumers hitting the warning can either provide MCP SDK or enable `auto-install-peers=true`.

## Dispositional lineage

The optional-peer dep posture itself is preserved per the disposition of `mmnto-ai/totem-strategy#404` (Proposal 286, closes prereq `mmnto-ai/totem#2018`). The `(c)` graceful-degradation impl in `totem search` — keyword fallback when the embedder is unavailable — is tracked as a separate follow-on against `mmnto-ai/totem#2018` and ships in its own PR; W5 is the version bump only.

## Why this is a PATCH bump

W5 is a dep-pin bump with no published code-surface delta and no enforced contract change. The optional-peer envelope narrowing is advisory (warnings, not errors). Downstream library consumers who do not import `@google/genai` see nothing change; consumers who do import it and are still on 1.x see a peer warning and can bump at their own cadence. Matches the W4 cohort-dep-wave precedent at `e4a24ec5`.
