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
// three fields orient consumes. `content` is absent for draft cards (no linked
// issue/PR), so it is optional and its `number` is optional within it.
const GhProjectItemSchema = z
  .object({
    status: z.string().optional(),
    title: z.string(),
    content: z
      .object({
        number: z.number().optional(),
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
  }));
}
