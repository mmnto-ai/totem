// totem-context: fetchBoardItems is synchronous — ghFetchAndParse uses safeExec (sync). Do not flag missing await.

import { z } from 'zod';

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

const GhProjectItemListSchema = z
  .object({
    items: z.array(GhProjectItemSchema),
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

const BOARD_ITEM_LIMIT = 200;

/**
 * Read the in-flight items of a GH Project board for `owner` / `projectNumber`.
 *
 * Throws (via `ghFetchAndParse` → `handleGhError`) when the board is
 * inaccessible / the project is absent / the JSON shape is unexpected; the
 * `orient` command catches that and renders a per-section `{ error }` envelope.
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
  return parsed.items.map((i) => ({
    status: i.status,
    title: i.title,
    contentNumber: i.content?.number,
    contentRepo: i.content?.repository,
    contentType: i.content?.type,
  }));
}
