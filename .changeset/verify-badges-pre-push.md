---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli+core): add `totem verify-badges` deterministic pre-push gate for shields.io claims (mmnto-ai/totem#1926)

Mechanizes the claim-discipline failures from #1925 R1 / R2, #1932, and #1933 — all four were post-merge audit catches of README claims that a deterministic check could have blocked at pre-push time. This is the _mechanism-tier_ gate per Tenet 15 (axiom mandate: encode rules as mechanism, not prose); it complements the LLM-tier spot-check shipped in `mmnto-ai/totem-strategy#331` (Proposal 277, Ollama).

**New CLI command:** `totem verify-badges` scans `README.md` additions in the branch diff and runs two deterministic checks against every shields.io badge:

1. **Tool-claim verification** — if the badge text names a tool (`Claude`, `Gemini`, `Cursor`, `Windsurf`, `Copilot`), at least one of the tool's integration files/directories must exist in the repo. Falsifying metric is file existence.
2. **Self-reference detection** — standard-claim badges (`AGENTS.md`, `MIT`, `Apache 2.0`, BSD/GPL/MPL variants) must link to canonical upstream docs, not internal repo paths (e.g., flagging `[![AGENTS.md](...)](./AGENTS.md)` as circular).

The check is stateless (no SHA-stamped flag files; recomputes from `git diff <base>...HEAD` each run), fast (file-existence O(badges × tool-claims), no network), and pre-push-budget compliant (ADR-031 FR-P01 <3s).

**Auto-wired into the pre-push hook** (`buildPrePushHook` in `install-hooks.ts`) gated on `README.md` and `.totem/compiled-rules.json` existing, alongside the existing `verify-manifest` + `lint` gates. Cohort repos that haven't installed Totem pipelines don't fire the check.

**New `@mmnto/totem` exports:** `extractBadgesFromDiff`, `verifyToolClaims`, `verifySelfReferenceLinks`, `DEFAULT_TOOL_INTEGRATIONS`, `ToolIntegrationConfigSchema`, `BadgeVerificationResultSchema`, plus types `ExtractedBadge` / `ToolIntegrationConfig` / `BadgeVerificationResult` / `PathExistsPredicate`.

**Scope cut (Q1 from spec):** Verification C (gh-api shape-usage threshold) deferred to a follow-on PR. A + B mechanize the 2/3 empirical-anchor majority; C carries a network dependency (gh CLI + auth + rate limits → graceful-degrade) that deserves its own PR description and test plan.

**Doctrine framing:** This PR is the _deterministic-tier_ complement to:

- `mmnto-ai/totem-strategy#331` (Proposal 277) — the LLM-tier Ollama spot-check.
- WWND Claim-Discipline Gate proposal (queued on strategy-Claude's lane).
- Tenet 19 covenant-claims-as-third-category amendment (queued on strategy-Claude's lane).

Verified locally: 1922 `@mmnto/totem` tests + 2168 `@mmnto/cli` tests all green.
