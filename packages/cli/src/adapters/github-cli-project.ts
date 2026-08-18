// totem-context: fetchBoardItems is synchronous — ghFetchAndParse uses safeExec (sync). Do not flag missing await.

import { z } from 'zod';

import { TotemError } from '@mmnto/totem';

import { ghFetchAndParse } from './gh-utils.js';

// ─── Board (GH Project) reader ──────────────────────────
//
// No existing adapter covers `gh project item-list`; `totem orient` is the
// first consumer (mmnto-ai/totem#2044). A GH Project lives under an `owner`
// and a numeric project id, neither derivable from the current repo alone —
// owner is derived from `gh repo view`, the project number from
// `orient.projectNumber` config / `TOTEM_ORIENT_PROJECT` env. This reader is
// Zod-validated so an unexpected shape surfaces as a TotemParseError (the
// caller maps that to a per-section `{ error }`, never a silent empty —
// Tenet 4).

// `gh project item-list --format json` returns extra columns (assignees,
// custom fields, …); `.passthrough()` tolerates them and we only validate the
// fields orient consumes. `content` is absent for draft cards (no linked
// issue/PR), so it is optional and its fields are optional within it.
// `repository` ('owner/repo') + `type` ('Issue' | 'PullRequest' | 'DraftIssue')
// are load-bearing for the coherence check: GH Projects are commonly org-level
// boards spanning multiple repos, so the drift predicate MUST scope to this
// repo's Issue cards or it false-flags every healthy cross-repo / PR card.
const GhProjectItemSchema = z
  .object({
    status: z.string().optional(),
    title: z.string(),
    content: z
      .object({
        number: z.number().optional(),
        repository: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// `totalCount` is the board's full card count regardless of `--limit` — the
// truncation signal the #2644 guard compares against. Optional: older gh
// versions omit it, and without it there is no signal to check.
const GhProjectItemListSchema = z
  .object({
    items: z.array(GhProjectItemSchema),
    totalCount: z.number().optional(),
  })
  .passthrough();

/** A single GH Project board card, reduced to the fields `totem orient` derives from. */
export interface BoardItem {
  /** Board status column (e.g. 'In Progress'). Absent items default to 'Todo' at the call site. */
  status?: string;
  title: string;
  /** The linked issue/PR number, when the card is backed by one (draft cards have none). */
  contentNumber?: number;
  /** The linked issue/PR's repo as 'owner/repo' (org boards span repos); absent for draft cards. */
  contentRepo?: string;
  /** The card content kind: 'Issue' | 'PullRequest' | 'DraftIssue'. */
  contentType?: string;
}

// Deliberately-complete page budget (mmnto-ai/totem#2644): the previous 200
// silently truncated >200-card boards — active tail cards vanished and the
// board section read as complete. `gh` paginates up to `--limit` and stops at
// the board's real card count, so a high limit costs nothing on small boards;
// the totalCount guard below keeps any board past this budget loud.
const BOARD_ITEM_LIMIT = 1000;

/**
 * Read the in-flight items of a GH Project board for `owner` / `projectNumber`.
 *
 * Throws (via `ghFetchAndParse` → `handleGhError`) when the board is
 * inaccessible / the project is absent / the JSON shape is unexpected — and
 * directly when the response is truncated (`items.length < totalCount`,
 * mmnto-ai/totem#2644); the `orient` command catches that and renders a
 * per-section `{ error }` envelope.
 */
export function fetchBoardItems(owner: string, projectNumber: number, cwd: string): BoardItem[] {
  const parsed = ghFetchAndParse(
    [
      'project',
      'item-list',
      String(projectNumber),
      '--owner',
      owner,
      '--format',
      'json',
      '--limit',
      String(BOARD_ITEM_LIMIT),
    ],
    GhProjectItemListSchema,
    `GH Project board ${owner}/${projectNumber}`,
    cwd,
  );
  // Truncation guard (Tenet 4, mmnto-ai/totem#2644): the board section presents
  // itself as the full in-flight set, so a short fetch must never read as
  // completeness — fail loud into the caller's { error } envelope instead.
  if (parsed.totalCount !== undefined && parsed.items.length < parsed.totalCount) {
    // 'SHIELD_FAILED' is this adapter's existing fetch-failure code (the
    // handleGhError fallthrough). The remediation stays in the message too:
    // orient's { error } envelope surfaces .message only, never recoveryHint.
    throw new TotemError(
      'SHIELD_FAILED',
      `GH Project board ${owner}/${projectNumber} truncated: fetched ${parsed.items.length} of ` +
        `${parsed.totalCount} cards (--limit ${BOARD_ITEM_LIMIT}) — raise BOARD_ITEM_LIMIT; ` +
        `a partial board must not derive orientation`,
      'Raise BOARD_ITEM_LIMIT in github-cli-project.ts so one fetch covers the whole board, then re-run `totem orient`.',
    );
  }
  return parsed.items.map((i) => ({
    status: i.status,
    title: i.title,
    contentNumber: i.content?.number,
    contentRepo: i.content?.repository,
    contentType: i.content?.type,
  }));
}
