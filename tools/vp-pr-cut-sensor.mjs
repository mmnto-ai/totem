#!/usr/bin/env node
/**
 * VP-PR cut sensor (mmnto-ai/totem#2325) — the totem-lane tooling half of the
 * release-planning doctrine (mmnto-ai/totem-strategy#839,
 * doctrine/packaging-conventions.md § "Release planning — the meaningful-cut
 * discipline", § Mechanism items 1–3).
 *
 * Runs ONLY against a Version-Packages PR (the changesets release branch) and
 * posts/updates ONE sticky comment classifying the pending cut:
 *
 *   1. `Consumer-impact:` body-tag scan over the VP-PR's ADDED CHANGELOG lines
 *      (at VP-PR time the changesets are consumed; the added-CHANGELOG side is
 *      exactly what ships to consumers).
 *   2. Path-heuristic classifier: each changelog entry leads with its squash
 *      commit's shorthash (`- abc1234: …`); the commit's changed paths are
 *      matched against the contract-bearing seam table so UNTAGGED
 *      contract-shaped entries get flagged.
 *   3. One sticky comment (marker + update-in-place): `internal-only: cut
 *      freely`, or `contract-bearing: <classes>` + the choreography template.
 *
 * NO new gate (Tenet 13, sensors-not-actuators): the comment is advisory; the
 * operator's cut word on the VP-PR merge remains the gate. Heuristics will
 * over-flag and miss by design — declaration carries intent, the sensor
 * catches the miss; grow the seam table by mining real misses at real cuts.
 *
 * Usage: node tools/vp-pr-cut-sensor.mjs --pr <number> [--dry-run]
 * Env:   GITHUB_TOKEN (posting + API reads), GITHUB_REPOSITORY (owner/repo)
 */

import * as process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Sticky-comment marker — the upsert key. Keep stable across versions. */
export const COMMENT_MARKER = '<!-- totem:vp-pr-cut-sensor -->';

/**
 * Contract-bearing seam table, seeded from the doctrine's class catalog
 * (mmnto-ai/totem#2325). Path heuristics only — the weakest classes
 * (gate-coupled warnings) carry no path signal and rely on declaration.
 * Root package.json is a two-class collision (toolchain floors ∪
 * restricted-pin bumps); flagged under one merged label rather than guessed.
 */
export const SEAM_RULES = [
  {
    cls: 'consumer config schema',
    test: (p) => p === 'packages/core/src/config-schema.ts',
  },
  {
    cls: 'ECL / file / wire formats',
    test: (p) =>
      /^packages\/(cli|core)\/src\/(commands\/)?(mail|ecl-)/.test(p) ||
      p === 'packages/core/src/compiler-schema.ts',
  },
  {
    cls: 'init-distributed content',
    test: (p) => /^packages\/cli\/src\/commands\/init/.test(p),
  },
  {
    cls: 'CLI surface',
    test: (p) => p === 'packages/cli/src/index.ts',
  },
  {
    cls: 'machine surfaces',
    test: (p) => p === 'action.yml' || p.startsWith('packages/mcp/src/'),
  },
  {
    cls: 'toolchain floors / restricted-pin (root manifest)',
    test: (p) => p === 'package.json' || p === 'pnpm-workspace.yaml',
  },
];

/**
 * Classify one commit's changed paths against the seam table. Test files are
 * excluded up front — a contract change ships in product source; test-only
 * churn against a seam path is not a consumer obligation.
 */
export function classifyPaths(paths) {
  const productPaths = paths.filter((p) => !/\.test\.(ts|tsx|mjs|cjs|js)$/.test(p));
  const hits = new Map();
  for (const rule of SEAM_RULES) {
    const matched = productPaths.filter((p) => rule.test(p));
    if (matched.length > 0) hits.set(rule.cls, matched);
  }
  return hits;
}

/**
 * Parse the VP-PR's ADDED changelog lines into per-entry records.
 *
 * An entry opens at `- <shorthash>: …`; a `Consumer-impact: <text>` line
 * belongs to the entry it appears under (the changeset body ships into the
 * entry's own body). `Updated dependencies [<hash>]` lines repeat entry
 * hashes for downstream packages — deduped, never opening a new tag scope.
 *
 * @param {string[]} addedLines lines added in CHANGELOG.md hunks (no '+' prefix)
 * @returns {{ entries: Map<string, { tags: string[] }> }}
 */
export function parseChangelogAdditions(addedLines) {
  const entries = new Map();
  let current;
  for (const line of addedLines) {
    const open = /^- ([0-9a-f]{7,12}): /.exec(line);
    if (open) {
      current = open[1];
      if (!entries.has(current)) entries.set(current, { tags: [] });
      continue;
    }
    const dep = /^- Updated dependencies \[([0-9a-f]{7,12})\]/.exec(line);
    if (dep) {
      if (!entries.has(dep[1])) entries.set(dep[1], { tags: [] });
      // A dependency-echo line is not a tag scope — the body that follows
      // belongs to no entry.
      current = undefined;
      continue;
    }
    const tag = /Consumer-impact:\s*(.+)/.exec(line);
    if (tag && current !== undefined) {
      entries.get(current).tags.push(tag[1].trim());
    }
  }
  return { entries };
}

/**
 * Compose the sticky comment body.
 *
 * @param {{ declared: Array<{ hash: string, tag: string }>,
 *           flagged: Array<{ hash: string, classes: Map<string, string[]> }>,
 *           scannedEntryCount: number,
 *           unresolved?: string[] }} input
 */
export function composeComment({ declared, flagged, scannedEntryCount, unresolved = [] }) {
  const lines = [COMMENT_MARKER, '## Release-cut sensor (mmnto-ai/totem#2325)', ''];

  if (declared.length === 0 && flagged.length === 0) {
    // An unscanned entry means the clean verdict is PARTIAL — say so rather
    // than let "cut freely" overclaim (no silent coverage caps; CR round 1).
    const qualifier =
      unresolved.length > 0
        ? ` **Partial verdict:** ${unresolved.length} entr${unresolved.length === 1 ? 'y' : 'ies'} could not be scanned (see below).`
        : '';
    lines.push(
      '**Verdict: `internal-only: cut freely`** — no `Consumer-impact:` tags declared and no contract-shaped paths flagged across ' +
        `${scannedEntryCount} changelog entr${scannedEntryCount === 1 ? 'y' : 'ies'}.` +
        qualifier,
      '',
    );
  } else {
    const classSet = new Set();
    for (const d of declared) classSet.add(d.tag);
    for (const f of flagged)
      for (const cls of f.classes.keys()) classSet.add(`${cls} (untagged ⚠)`);
    lines.push(
      `**Verdict: \`contract-bearing\`** — ${[...classSet].map((c) => `\`${c}\``).join(' · ')}`,
      '',
    );
    if (declared.length > 0) {
      lines.push('**Declared (`Consumer-impact:` tags):**', '');
      for (const d of declared) lines.push(`- \`${d.hash}\`: ${d.tag}`);
      lines.push('');
    }
    if (flagged.length > 0) {
      lines.push(
        '**⚠ Untagged contract-shaped entries** (path heuristics — verify each, then tag the changeset entry or dismiss here):',
        '',
      );
      for (const f of flagged) {
        for (const [cls, paths] of f.classes) {
          lines.push(`- \`${f.hash}\`: ${cls} — \`${paths.join('`, `')}\``);
        }
      }
      lines.push('');
    }
    lines.push(
      '### Choreography (fill before the cut word)',
      '',
      '- **Which consumers move:** _…_',
      '- **In what order:** _…_',
      '- **Who owns which half:** _…_',
      '',
    );
  }

  // Unscanned entries render in EVERY verdict shape — a coverage gap the
  // reader can see beats a clean-looking comment that quietly skipped work.
  if (unresolved.length > 0) {
    lines.push(
      `**⚠ Unscanned entries** (commit unresolvable — classify by hand before trusting the verdict): ${unresolved.map((h) => `\`${h}\``).join(', ')}`,
      '',
    );
  }

  lines.push(
    '---',
    "_Advisory only (Tenet 13) — the cut gate is unchanged: the operator's merge word on this VP-PR remains the gate. " +
      'Doctrine: `packaging-conventions.md` § "Release planning — the meaningful-cut discipline" (mmnto-ai/totem-strategy#839). ' +
      'Heuristic misses are seam-table mining input, not sensor failures._',
  );
  return lines.join('\n');
}

// ─── GitHub API (dependency-free) ────────────────────────

/** Per-request cap — a hung fetch fails fast instead of eating the job timeout. */
const REQUEST_TIMEOUT_MS = 30_000;

async function gh(token, url, init = {}) {
  const res = await fetch(`https://api.github.com${url}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      // The REST contract wants an explicit JSON content-type on bodied
      // requests; Node fetch would otherwise default a string body to
      // text/plain (GCA + greptile round 1).
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API ${init.method ?? 'GET'} ${url} → ${res.status}: ${await res.text()}`,
    );
  }
  return res.json();
}

/** All pages of a list endpoint (per_page=100). */
async function ghPaged(token, url) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const batch = await gh(token, `${url}${sep}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

/** Extract added lines from CHANGELOG.md patches on the VP-PR. */
export function addedChangelogLines(files) {
  const lines = [];
  for (const f of files) {
    if (!f.filename.endsWith('CHANGELOG.md') || typeof f.patch !== 'string') continue;
    for (const raw of f.patch.split('\n')) {
      if (raw.startsWith('+') && !raw.startsWith('+++')) lines.push(raw.slice(1));
    }
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const prIdx = args.indexOf('--pr');
  const prNumber = prIdx >= 0 ? Number(args[prIdx + 1]) : NaN;
  const dryRun = args.includes('--dry-run');
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!Number.isInteger(prNumber) || !token || !repo) {
    console.error(
      'usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node tools/vp-pr-cut-sensor.mjs --pr <number> [--dry-run]',
    );
    process.exitCode = 2;
    return;
  }

  const files = await ghPaged(token, `/repos/${repo}/pulls/${prNumber}/files`);
  const { entries } = parseChangelogAdditions(addedChangelogLines(files));

  const declared = [];
  const flagged = [];
  const unresolved = [];
  for (const [hash, entry] of entries) {
    for (const tag of entry.tags) declared.push({ hash, tag });
    if (entry.tags.length > 0) continue; // declaration carries intent; no double-flag
    // Path classification via the entry's squash commit (best-effort: a
    // garbage-collected or ambiguous shorthash degrades to UNSCANNED — carried
    // into the comment so the coverage gap is visible, never a silent drop).
    try {
      const commit = await gh(token, `/repos/${repo}/commits/${hash}`);
      const paths = (commit.files ?? []).map((f) => f.filename);
      const classes = classifyPaths(paths);
      if (classes.size > 0) flagged.push({ hash, classes });
    } catch (err) {
      console.error(
        `[cut-sensor] commit ${hash} unresolvable — reported unscanned: ${String(err)}`,
      );
      unresolved.push(hash);
    }
  }

  const body = composeComment({ declared, flagged, scannedEntryCount: entries.size, unresolved });

  if (dryRun) {
    console.log(body);
    return;
  }

  const comments = await ghPaged(token, `/repos/${repo}/issues/${prNumber}/comments`);
  const existing = comments.find(
    (c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER),
  );
  if (existing) {
    await gh(token, `/repos/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    console.error(`[cut-sensor] updated comment ${existing.id} on PR #${prNumber}`);
  } else {
    await gh(token, `/repos/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    console.error(`[cut-sensor] posted comment on PR #${prNumber}`);
  }
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[cut-sensor] ${String(err)}`);
    process.exitCode = 1;
  });
}
