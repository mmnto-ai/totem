import { TotemError } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Wrap';

// ─── Options ────────────────────────────────────────────

export interface WrapOptions {
  model?: string;
  fresh?: boolean;
  yes?: boolean;
}

// ─── Main command ───────────────────────────────────────

/**
 * RETIRED as of mmnto-ai/totem#1361.
 *
 * `totem wrap` previously orchestrated a 6-step post-merge workflow
 * (extract lessons, sync index, triage, update project docs, inject
 * doc values, compile and export rules). Step 4 (`totem docs`) iterates
 * every target in `config.docs` and runs an LLM rewrite pass. The
 * dirty-file guard at `docs.ts:450` catches uncommitted changes but
 * does nothing for recent committed edits, so any hand-crafted refresh
 * of `docs/active_work.md`, `docs/roadmap.md`, or `docs/architecture.md`
 * gets silently overwritten on the next wrap invocation.
 *
 * This is a Tenet 5 ("Sensors Not Actuators") violation. The command is
 * blocked behind a hard error until three return conditions ship:
 *
 *   1. `--skip-docs` flag exists on wrap
 *   2. `totem docs` has a freshness guard (skip targets whose git
 *      author date is within the last 24 hours without `--force-regen`)
 *   3. End-to-end regression test for wrap locks the invariant that
 *      hand-crafted docs survive the pipeline
 *
 * The function signature, options interface, and test scaffolding
 * are preserved below for institutional memory. See
 * mmnto-ai/totem#1361 for the tracking ticket. Git log has the
 * original 6-step implementation (most recent version in commit
 * bd638103's parent tree).
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function wrapCommand(_prNumbers: string[], _options: WrapOptions): Promise<void> {
  throw new TotemError(
    'CONFIG_INVALID',
    'totem wrap is retired. It silently overwrites hand-crafted docs via the totem docs step.',
    [
      'Run the individual steps manually:',
      '',
      '  pnpm exec totem extract <pr-numbers> --yes',
      '  pnpm exec totem sync',
      '  pnpm exec totem compile --export',
      '  git checkout HEAD -- .totem/compiled-rules.json',
      '  pnpm run format',
      '  git add .totem/lessons/ .github/copilot-instructions.md .junie/skills/totem-rules/rules.md',
      "  git commit -m 'chore: totem postmerge lessons for <prs>'",
      '',
      'Tracking: mmnto-ai/totem#1361',
    ].join('\n'),
  );
}

// TAG is kept as a named export anchor so future non-retired implementations
// can restore their log prefix without re-deriving the token.
export { TAG };
