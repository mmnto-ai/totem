/**
 * `totem doctor` — the agent-arming SENSE (mmnto-ai/totem#3130, designed with
 * mmnto-ai/totem#3042).
 *
 * Since the opt-in ruling the pinned `hooks.tier` governs EVERY shell, an AI
 * agent's included: an agent shell arms the strict tier on a standard-tier
 * install only when the tracked config sets `hooks.agentArming: 'strict'`,
 * which the installer renders into the two enforcement hooks. Before it, the
 * markers alone armed strict on every install, so a repository that relied on
 * that arming and re-renders on the cut carrying the ruling without setting the
 * key sees its agents' commits and pushes drop to the standard arm with nothing
 * at commit or push time saying so (the strict arm is exactly the one that no
 * longer runs). This row is where it is said.
 *
 * Tenet 9/13: the row senses, it never enforces. `gateExempt: true`, never
 * `fail`, so no `--strict` tier can give it teeth.
 *
 *   pass — the key is declared (`'strict'` or `'off'`), whatever the value: a
 *          declared `'off'` is a decision, not an omission.
 *   pass — the key is unset and no seat is registered under
 *          `.totem/orchestration/` (a plain consumer, whose agents follow the
 *          pinned tier by the ruling's default).
 *   warn — the key is unset and the repository registers one or more seats:
 *          the message names them and what their pushes now skip, the
 *          remediation names the key and the re-render.
 *   warn — the seat read itself threw (the core import or the repo-root
 *          resolver): the reason, never a clean line. Core's own read,
 *          `readSeatDirs`, treats a missing or unreadable orchestration tree as
 *          zero seats by contract, so that shape passes as "no seats", as the
 *          Seat Identity row does.
 *
 * What counts as a registered seat is a seat DIRECTORY under
 * `.totem/orchestration/`: the dirs ARE the registration (the roster ruling,
 * mmnto-ai/totem#2141, applied by `readSeatDirs`); a `config.json` `host_agents`
 * entry is a self-resolution override, not a registration, and is not counted.
 * The tree is gitignored and lives at the resident checkout, so a run from a
 * linked worktree that carries none reads "no seats" — the reach the Seat
 * Identity row has.
 *
 * The key is read from the config `doctorCommand` already loaded (threaded, like
 * `checkGitHooks`), never re-opened here; `undefined` covers no config, a config
 * that would not load and the global profile alike — in each the installer
 * renders `'off'`, so the row reads the key as unset; whether a config loaded at
 * all is the Config row's report.
 *
 * Core is dynamic-imported so `@mmnto/totem` stays off the CLI cold-start
 * graph, matching every other doctor check.
 */

import type { DiagnosticResult } from './doctor.js';
import { AGENT_SHELL_MARKERS } from './install-hooks.js';

/** Row label, `padEnd(18)`-safe in the doctor render. */
export const AGENT_ARMING_CHECK_NAME = 'Agent Arming';

/** Seat names printed before the count takes over, so a wide cohort stays one line. */
const SEATS_NAMED = 8;

export async function checkAgentArming(
  cwd: string,
  config?: { hooks?: { agentArming?: 'off' | 'strict' } },
): Promise<DiagnosticResult> {
  const value = config?.hooks?.agentArming;
  if (value !== undefined) {
    // The one table the hook renders from, so this row never names a subset
    // of the markers the installed hook actually tests.
    const markers = AGENT_SHELL_MARKERS.join(', ');
    return {
      name: AGENT_ARMING_CHECK_NAME,
      status: 'pass',
      message:
        value === 'strict'
          ? `hooks.agentArming: strict — an AI-agent shell (a marker in the shell: ${markers}) arms the strict tier; a human's shell keeps the pinned tier; rendered into the hooks at install, so re-run \`totem hook install --force\` after changing it`
          : 'hooks.agentArming: off — every shell, an AI agent shell included, follows the pinned hooks.tier; rendered into the hooks at install, so re-run `totem hook install --force` after changing it',
      gateExempt: true,
    };
  }

  // Unset: whether that matters depends on whether anyone's agents push here.
  let seats: string[];
  try {
    const { deriveSeatStatuses, resolveTotemRepoRootSync } = await import('@mmnto/totem');
    // The shared walk-start-is-not-the-root contract (mmnto-ai/totem#2312): a
    // doctor run from a subdirectory must still resolve the real orchestration
    // tree, or this row renders a false-clean "no seats registered".
    const repoRoot = resolveTotemRepoRootSync(undefined, cwd);
    seats = deriveSeatStatuses(repoRoot)
      .map((status) => status.seat)
      .sort();
    // totem-context: intentional cleanup — best-effort sensor read: a scan failure is REPORTED as a warn row that carries the reason, so this sensor never takes `totem doctor` down with it and never reads an unscanned tree as clean (report-only, Tenet 13; the Seat Identity precedent).
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      name: AGENT_ARMING_CHECK_NAME,
      status: 'warn',
      message: `hooks.agentArming is unset, and whether seats are registered here could not be derived: ${reason.split('\n')[0]}`,
      remediation:
        "set hooks.agentArming ('strict': agent shells arm the strict tier; 'off': every shell follows the pinned tier), then `totem hook install --force`",
      gateExempt: true,
    };
  }

  if (seats.length === 0) {
    return {
      name: AGENT_ARMING_CHECK_NAME,
      status: 'pass',
      message:
        'hooks.agentArming unset — an AI-agent shell follows the pinned hooks.tier (off by default since mmnto-ai/totem#3130); no seats registered under .totem/orchestration/',
      gateExempt: true,
    };
  }

  const named = seats.slice(0, SEATS_NAMED).join(', ');
  const more = seats.length > SEATS_NAMED ? ` and ${seats.length - SEATS_NAMED} more` : '';
  return {
    name: AGENT_ARMING_CHECK_NAME,
    status: 'warn',
    message: `hooks.agentArming is unset (no loaded repo config declares it) and this repository registers ${seats.length} seat(s) under .totem/orchestration/ (${named}${more}) — since mmnto-ai/totem#3130 an AI-agent shell follows the pinned hooks.tier unless the key is 'strict', so on a standard-tier install these seats' commits skip the spec-evidence gate and their pushes skip doctor --strict and the review gate (the legs gate blocks only under hooks.legsOwed.enforce: block)`,
    remediation:
      "declare hooks.agentArming in the tracked config — 'strict' (agent shells arm the strict tier, a human's shell keeps the pinned tier) or 'off' (every shell follows the pinned tier) — then `totem hook install --force`",
    gateExempt: true,
  };
}
