---
'@mmnto/cli': patch
---

chore(skills): fix 3 CR findings in canonical scaffold templates (lc#406 R1 deferral)

Resolves the 3 CR findings on cohort canonical skill templates surfaced at [`mmnto-ai/liquid-city#406`](https://github.com/mmnto-ai/liquid-city/pull/406) R1, deferred upstream by `lc-claude` (correct call — applying locally would have diverged the LC copy from the cohort canonical and repeated the drift pattern that the scope-creep reversion just resolved).

## What ships

All three fixes are content-only edits to the canonical scaffold templates in `packages/cli/src/commands/init-templates.ts`, mirrored into the locally-rendered copies at `.claude/skills/review-reply/SKILL.md` and `.claude/skills/signoff/SKILL.md`. No API change, no behavior change in the CLI itself.

**Finding 1 (MAJOR) — review-reply skill, GCA-items bullet**

Before:

```bash
gh api `repos/{owner}/{repo}/issues/$ARGUMENTS/comments` --input -
```

After:

```bash
gh pr comment $ARGUMENTS --body-file -
```

`{owner}/{repo}` are GitHub-REST-API-doc-style placeholders. They're fine when a human consults the docs and substitutes consciously — they're NOT fine in a SKILL.md template that's read by agents executing literally. The `gh pr comment` substitution removes the placeholder class entirely, drops the resolution boilerplate, and is portable (PRs ARE issues in GitHub's data model, so the same `gh pr comment` invocation handles both).

**Finding 2 (MAJOR) — signoff skill, Visiting-case clause**

Before: "...where `<your-home-agent-id>` is the agent-id from the row matching the repo you were last working in..."

After: "...where `<your-home-agent-id>` is your own agent-id (e.g., a `strategy-claude` session always writes as `strategy-claude` regardless of which repo it's visiting...)..."

The original phrasing read as temporal-state language ("which repo did I touch most recently?"); the actual semantic is identity-lookup ("you are `strategy-claude` regardless of where you're visiting"). The example in the same clause already implied the identity-semantic, but the lead wording invited the temporal-state misread.

**Finding 3 (NITPICK) — signoff skill, Override-hook prose**

Before: "Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, prefer that list over the hardcoded map. Reserved for repos that legitimately host an agent not in the default map."

After: "Override hook: if the consuming repo carries `.totem/orchestration/config.json` with a `host_agents: string[]` field, that list **replaces** the basename map's answer for this repo (precedence: `TOTEM_SELF_AGENT` env > config.json `host_agents` > hardcoded basename map). The returned list of agent-ids is used by consumers (e.g., `totem mail`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session. Reserved for repos that legitimately host an agent not in the default map — e.g., a custom-named cohort variant or an orphan-stream repo declaring itself as an agent host."

Wording corrected against the actual runtime contract in [`packages/core/src/orchestration-resolver.ts:150-260`](https://github.com/mmnto-ai/totem/blob/main/packages/core/src/orchestration-resolver.ts) on two counts:

1. The `host_agents` override **replaces** the basename map's answer (early-return at line 245), it does not augment a candidate set
2. The resolver returns a **list** of agent-ids that consumers (e.g., `totem mail`) filter against — there is no per-agent-id selection step inside the resolver. CR's "selection semantics when multiple entries are present" framing was a category error against the actual contract; the corrected wording clarifies what the resolver does instead of inventing a selection rule that doesn't exist.

## Propagation

These fixes land in the canonical scaffold source. They flow to cohort consumers via the next `totem init` cycle (or, post `--force-skill-refresh` once W3.5 ships, via explicit skill-refresh invocation).

## Cross-references

- [`mmnto-ai/liquid-city#406`](https://github.com/mmnto-ai/liquid-city/pull/406) — LC consumer that surfaced the findings; CR R1 disposition will cross-link this PR
- [`packages/core/src/orchestration-resolver.ts:150-260`](https://github.com/mmnto-ai/totem/blob/main/packages/core/src/orchestration-resolver.ts) — runtime source-of-truth for Finding 3 wording
