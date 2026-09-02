/**
 * The run artifact's closed vocabularies, re-exported for the CLI's
 * SYNCHRONOUS sites (mmnto-ai/totem#2700).
 *
 * Two of them cannot reach these values through the `await
 * import('@mmnto/totem')` form that `packages/cli/src/commands/**` is held to
 * (compiled lesson 2266fc0dfe824f24 — the core barrel must not land on a
 * command module's static graph):
 *
 * - `buildPreCommitHook` renders the anchor kinds and the prompt-source
 *   spelling into the strict evidence reader's `node -e` body. It is
 *   synchronous by contract: `tools/pre-commit` parity, `doctor`'s canonical
 *   regeneration and every installer call site render it inline.
 * - `resolveGroundingAnchor` classifies an anchor as a pure, synchronous
 *   function so it can be unit-tested without a command harness.
 *
 * This module is the ONE static seam, in the `git.ts` shape: a pure re-export
 * and nothing else, so every spelling still has exactly one definition — the
 * core schema's. Re-spelling any of them here would recreate the drift the
 * constants exist to prevent.
 */
export {
  GROUNDING_ANCHOR_FREE_TEXT,
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_MIXED,
  GROUNDING_ANCHOR_RECORD,
  PROMPT_SOURCE_BUILTIN,
  PROMPT_SOURCE_OVERRIDE,
} from '@mmnto/totem';
