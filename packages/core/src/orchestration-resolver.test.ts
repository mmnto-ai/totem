/**
 * Tests for `resolveOrchestrationPaths` (mmnto-ai/totem-strategy#341, ADR-106 — Proposal 282).
 *
 * Filesystem-driven; tests construct real temp directories for each
 * presence permutation (none / partial / full) and verify the resolver
 * returns the discriminated `source` field plus the expected
 * path fields. Per-test cleanup wipes the tmp tree so a re-run starts
 * from a clean state. Mirrors the `substrate-resolver.test.ts` shape so
 * the two resolvers' tests stay symmetric.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isPathSafeAgentId,
  knownCohortAgents,
  type OrchestrationPaths,
  resolveOrchestrationPaths,
  resolveSelfAgents,
} from './orchestration-resolver.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;
let repoRoot: string;

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Build a partial or full orchestration tree for `agentId` at `repoRoot`.
 * Pass an explicit subset of `'outbox' | 'processed' | 'journal'` to
 * create only those subdirs; pass `'all'` for the full tree.
 */
function mkOrchestrationTree(
  repoRoot: string,
  agentId: string,
  subdirs: Array<'outbox' | 'processed' | 'journal'> | 'all',
): void {
  const base = path.join(repoRoot, '.totem', 'orchestration', agentId);
  const wanted: Array<'outbox' | 'processed' | 'journal'> =
    subdirs === 'all' ? ['outbox', 'processed', 'journal'] : subdirs;
  for (const sub of wanted) {
    mkDir(path.join(base, sub));
  }
}

beforeEach(() => {
  // totem-context: test fixture only; agents do not consume this temp dir.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-orchestration-resolver-'));
  repoRoot = mkDir(path.join(tmpRoot, 'repo'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// ─── source: 'none' ────────────────────────────────────────────────────────

describe('resolveOrchestrationPaths — absent', () => {
  it("returns source: 'none' with all null paths when no orchestration tree exists", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when the orchestration dir exists but the agent subdir does not", () => {
    mkDir(path.join(repoRoot, '.totem', 'orchestration'));
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });

  it("returns source: 'none' when a different agent's tree exists at the same repo", () => {
    mkOrchestrationTree(repoRoot, 'strategy-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });
});

// ─── source: 'orchestration' — full tree ───────────────────────────────────

describe('resolveOrchestrationPaths — full tree', () => {
  it("returns source: 'orchestration' with all three absolute paths when every subdir exists", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    );
    expect(result.processed).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'processed')),
    );
    expect(result.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
  });

  it('resolves distinct paths for distinct agents at the same repo', () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    mkOrchestrationTree(repoRoot, 'totem-gemini', 'all');
    const claude = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    const gemini = resolveOrchestrationPaths(repoRoot, 'totem-gemini');
    expect(claude.source).toBe('orchestration');
    expect(gemini.source).toBe('orchestration');
    expect(claude.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(gemini.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-gemini', 'journal')),
    );
    expect(claude.journal).not.toBe(gemini.journal);
  });

  it('resolves the same agent across distinct repo roots independently', () => {
    const otherRepo = mkDir(path.join(tmpRoot, 'other-repo'));
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    mkOrchestrationTree(otherRepo, 'totem-claude', 'all');
    const a = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    const b = resolveOrchestrationPaths(otherRepo, 'totem-claude');
    expect(a.journal).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(b.journal).toBe(
      path.normalize(path.join(otherRepo, '.totem', 'orchestration', 'totem-claude', 'journal')),
    );
    expect(a.journal).not.toBe(b.journal);
  });
});

// ─── source: 'orchestration' — partial tree ────────────────────────────────

describe('resolveOrchestrationPaths — partial tree', () => {
  it("returns source: 'orchestration' with only journal populated when other subdirs are absent", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['journal']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.journal).not.toBeNull();
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
  });

  it("returns source: 'orchestration' with only outbox populated", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['outbox']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).not.toBeNull();
    expect(result.journal).toBeNull();
    expect(result.processed).toBeNull();
  });

  it("returns source: 'orchestration' with outbox + processed but no journal", () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', ['outbox', 'processed']);
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).not.toBeNull();
    expect(result.processed).not.toBeNull();
    expect(result.journal).toBeNull();
  });
});

// ─── path normalization / robustness ───────────────────────────────────────

describe('resolveOrchestrationPaths — robustness', () => {
  it('treats a file in place of a subdir as absent', () => {
    const base = path.join(repoRoot, '.totem', 'orchestration', 'totem-claude');
    mkDir(base);
    // totem-context: writing a placeholder file to test the file-vs-directory predicate in the resolver; not a hooks-manager bypass — `journal` here is an orchestration subdir name, not a git hook path.
    fs.writeFileSync(path.join(base, 'journal'), '');
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    // journal exists as a file, not a directory → treated as absent
    expect(result.journal).toBeNull();
  });

  it('normalizes paths when given a repoRoot with redundant separators', () => {
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    // Intentionally pass a non-normalized repo root (trailing separators + redundant `.`).
    const noisy = path.join(repoRoot, '.', '.');
    const result = resolveOrchestrationPaths(noisy, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).toBe(
      path.normalize(path.join(repoRoot, '.totem', 'orchestration', 'totem-claude', 'outbox')),
    );
  });

  it('returns absolute paths when given a relative repoRoot (parity with resolveSubstratePaths)', () => {
    // Contract violation case: caller passes a relative anchor. Without
    // `path.resolve` at the top of the resolver, the output would be
    // relative too — a quiet correctness slip. Mirrors
    // `resolveSubstratePaths` (substrate-resolver.ts) which runs
    // `path.resolve(configRoot)` on its anchor for the same reason.
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    const relativeRepo = path.relative(process.cwd(), repoRoot);
    const result = resolveOrchestrationPaths(relativeRepo, 'totem-claude');
    expect(result.source).toBe('orchestration');
    expect(result.outbox).not.toBeNull();
    expect(path.isAbsolute(result.outbox!)).toBe(true);
    expect(path.isAbsolute(result.processed!)).toBe(true);
    expect(path.isAbsolute(result.journal!)).toBe(true);
  });

  it('OrchestrationPaths exported type is discriminable on source', () => {
    const result: OrchestrationPaths = resolveOrchestrationPaths(repoRoot, 'totem-claude');
    if (result.source === 'none') {
      expect(result.outbox).toBeNull();
      expect(result.processed).toBeNull();
      expect(result.journal).toBeNull();
    }
  });
});

// ─── agentId validation (defense-in-depth against path traversal) ──────────

describe('resolveOrchestrationPaths — agentId validation', () => {
  it("returns source: 'none' for an empty agentId", () => {
    const result = resolveOrchestrationPaths(repoRoot, '');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
    expect(result.processed).toBeNull();
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains '..' (parent-dir traversal)", () => {
    // A traversal-bearing agentId without the validation would normalize to
    // an absolute path outside `.totem/orchestration/`; the validation
    // short-circuits before path composition.
    mkOrchestrationTree(repoRoot, 'totem-claude', 'all');
    const result = resolveOrchestrationPaths(repoRoot, '../etc');
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });

  it("returns source: 'none' when agentId contains '/' (POSIX path separator)", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem/claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains '\\' (Windows path separator)", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem\\claude');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' when agentId contains a null byte", () => {
    const result = resolveOrchestrationPaths(repoRoot, 'totem-claude\0/etc');
    expect(result.source).toBe('none');
    expect(result.journal).toBeNull();
  });

  it("returns source: 'none' for non-string agentId (defensive type check)", () => {
    // Defense against untyped JS callers passing through the override hook.
    // totem-context: cast through `unknown` to reach the runtime path that
    // TypeScript would otherwise forbid; the validation must hold even
    // when a config.json supplies non-string `host_agents` entries.
    const result = resolveOrchestrationPaths(repoRoot, null as unknown as string);
    expect(result.source).toBe('none');
    expect(result.outbox).toBeNull();
  });
});

// ─── resolveSelfAgents (mmnto-ai/totem#1970, ADR-106 § 3 / ADR-107) ────────

/**
 * Build a `.totem/orchestration/config.json` with the given content. Caller
 * controls the directory creation flow so malformed-JSON and missing-dir
 * edge cases stay explicit in the test body.
 */
function writeConfig(repoRoot: string, content: string): void {
  const dir = path.join(repoRoot, '.totem', 'orchestration');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), content, 'utf-8');
}

describe('resolveSelfAgents — basename map (default precedence)', () => {
  it('returns Claude+Gemini pair for `totem`', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('returns strategy pair for `totem-strategy`', () => {
    const strategyRoot = mkDir(path.join(tmpRoot, 'totem-strategy'));
    const result = resolveSelfAgents(strategyRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['strategy-claude', 'strategy-gemini']);
  });

  it('returns lc pair for `liquid-city`', () => {
    const lcRoot = mkDir(path.join(tmpRoot, 'liquid-city'));
    const result = resolveSelfAgents(lcRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['lc-claude', 'lc-gemini']);
  });

  it('returns single Gemini agent for `totem-status` (no Claude variant)', () => {
    const statusRoot = mkDir(path.join(tmpRoot, 'totem-status'));
    const result = resolveSelfAgents(statusRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['status-gemini']);
  });

  it("returns source: 'none' and empty list for orphan-stream repo `totem-playground`", () => {
    const orphanRoot = mkDir(path.join(tmpRoot, 'totem-playground'));
    const result = resolveSelfAgents(orphanRoot, {});
    // Empty cohort map entry falls through to 'none' (no agents to claim).
    expect(result.source).toBe('none');
    expect(result.agents).toEqual([]);
  });

  it("returns source: 'none' for an unknown repo basename", () => {
    const unknownRoot = mkDir(path.join(tmpRoot, 'some-third-party-repo'));
    const result = resolveSelfAgents(unknownRoot, {});
    expect(result.source).toBe('none');
    expect(result.agents).toEqual([]);
  });
});

describe('resolveSelfAgents — config.json host_agents override', () => {
  it('prefers host_agents over the basename map when both are present', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['custom-claude'] }));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['custom-claude']);
  });

  it('lets host_agents promote an orphan-stream repo to a real agent host', () => {
    const orphanRoot = mkDir(path.join(tmpRoot, 'totem-playground'));
    writeConfig(orphanRoot, JSON.stringify({ host_agents: ['playground-claude'] }));
    const result = resolveSelfAgents(orphanRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['playground-claude']);
  });

  it('falls through to the basename map when host_agents is empty', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: [] }));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('falls through when host_agents is not an array', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: 'totem-claude' }));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
  });

  it('falls through on malformed JSON without throwing', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, '{ "host_agents": [not-json]');
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('drops path-traversal entries from host_agents before returning', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(
      totemRoot,
      JSON.stringify({ host_agents: ['..', '../escape', 'a/b', 'valid-agent'] }),
    );
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['valid-agent']);
  });

  it('drops control/whitespace/win32-reserved entries from host_agents (#2134 R3)', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(
      totemRoot,
      JSON.stringify({ host_agents: ['two words', 'a*b', 'a:b', 'valid-agent'] }),
    );
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['valid-agent']);
  });

  it('rejects mixed-type host_agents and falls through to basename map', () => {
    // Zod array schema is strict: any non-string entry fails the parse, so the
    // whole config is ignored. Stricter than silent per-entry filtering, but
    // safer — a typo-by-author or accidental object literal in the array gets
    // a deterministic fall-through to the cohort default rather than a silently
    // partial agent list.
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(
      totemRoot,
      JSON.stringify({ host_agents: [null, 42, { agent: 'x' }, 'real-agent'] }),
    );
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('rejects empty-string entries in host_agents (z.string().min(1))', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['', 'real-agent'] }));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
  });
});

describe('resolveSelfAgents — TOTEM_SELF_AGENT env var (highest precedence)', () => {
  it('overrides both config and basename map', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['config-agent'] }));
    const result = resolveSelfAgents(totemRoot, { TOTEM_SELF_AGENT: 'env-agent' });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['env-agent']);
  });

  it('parses a comma-separated list', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, {
      TOTEM_SELF_AGENT: 'totem-claude, totem-gemini ,extra-agent',
    });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini', 'extra-agent']);
  });

  it('drops empty/whitespace entries', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, { TOTEM_SELF_AGENT: 'a,, ,b,' });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['a', 'b']);
  });

  it('drops path-traversal entries from env var', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, {
      TOTEM_SELF_AGENT: '..,../escape,a/b,real-agent',
    });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['real-agent']);
  });

  it('drops control/whitespace/win32-reserved entries from env var (#2134 R3)', () => {
    // The read path enforces the same full path-segment contract as the mail
    // actuator's recipient validation — not just the traversal subset.
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, {
      TOTEM_SELF_AGENT: 'two words,a:b,a*b,ok-agent',
    });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['ok-agent']);
  });

  it('falls through to config when env var is empty after sanitization', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['config-agent'] }));
    const result = resolveSelfAgents(totemRoot, { TOTEM_SELF_AGENT: '..,,, ' });
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['config-agent']);
  });

  it('falls through to basename map when env var is whitespace-only', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot, { TOTEM_SELF_AGENT: '   ' });
    expect(result.source).toBe('map');
  });

  it('defaults to process.env when env arg omitted', () => {
    // No env-arg branch: just confirm the call shape is callable without
    // mutating real env. The env-precedence semantics are exercised by the
    // injected-env tests above; this asserts the default-argument branch
    // is reachable without throwing.
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot);
    expect(result.agents.length).toBeGreaterThan(0);
  });
});

describe('resolveSelfAgents — path-normalization', () => {
  it('resolves relative repo paths via path.resolve before basename lookup', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    // Pass an obviously-non-absolute path; the resolver must normalize it.
    const relative = path.relative(process.cwd(), totemRoot);
    const result = resolveSelfAgents(relative, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('handles trailing path separators in repoRoot', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    const result = resolveSelfAgents(totemRoot + path.sep, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });
});

describe('isPathSafeAgentId — path-segment guard (mmnto-ai/totem#2134)', () => {
  it('accepts plain cohort agent-ids', () => {
    for (const id of ['totem-claude', 'strategy-claude', 'status-gemini', 'broadcast', 'a.b_c-1']) {
      expect(isPathSafeAgentId(id)).toBe(true);
    }
  });

  it('rejects traversal, separators, and null bytes', () => {
    for (const id of ['', '..', '../evil', 'a/b', 'a\\b', 'a\0b']) {
      expect(isPathSafeAgentId(id)).toBe(false);
    }
  });

  it('rejects control, whitespace, and win32-reserved characters (CR R2)', () => {
    // Control/escape chars are terminal-injection vectors into logs and
    // dispatch markdown; `< > : " | ? *` are illegal in win32 filenames.
    // ESC/DEL are built via fromCharCode so the source carries no raw
    // control bytes.
    const esc = String.fromCharCode(0x1b);
    const del = String.fromCharCode(0x7f);
    const unsafe = [
      'a b',
      'a\tb',
      'a\nb',
      `esc${esc}[31m`,
      `del${del}`,
      ...'<>:"|?*'.split('').map((c) => `a${c}b`),
    ];
    for (const id of unsafe) {
      expect(isPathSafeAgentId(id)).toBe(false);
    }
  });
});

describe('knownCohortAgents — single-source recipient set', () => {
  it('derives from the cohort map and every id passes the path-segment guard', () => {
    const agents = knownCohortAgents();
    expect(agents).toContain('totem-claude');
    expect(agents).toContain('strategy-claude');
    // Self-consistency lock: an id added to COHORT_AGENT_MAP that fails the
    // guard would be unroutable by `totem mail send` — catch it here, not in
    // a failed dispatch.
    for (const id of agents) {
      expect(isPathSafeAgentId(id)).toBe(true);
    }
  });
});

// The `cohortRepos()` interim constant (shipped 1.90.0, product-locked) and its
// lock-test were RETIRED in mmnto-ai/totem#2310: the ecl-gc A2.2 completeness
// roster is now resolved from consumer config (`ecl.cohortRepos`), so OUR
// cohort's frozen value lives in `totem.config.ts`, not a core constant. See
// `packages/core/src/config-schema.test.ts` (schema) and
// `packages/cli/src/commands/ecl-gc.test.ts` (resolution precedence).

// ─── resolveSelfAgents — seat dirs (mmnto-ai/totem#2141) ───────────────────

describe('resolveSelfAgents — seat dirs (mmnto-ai/totem#2141)', () => {
  it('a BARE seat dir registers the seat with zero config/map presence (repo+1 zero surfaces)', () => {
    // The totem-codex exhibit: unknown basename, no config, no subdirs — the
    // directory alone IS the registration (design Q3: requiring subdirs would
    // re-introduce a provisioning step).
    const unknownRoot = mkDir(path.join(tmpRoot, 'some-third-party-repo'));
    mkDir(path.join(unknownRoot, '.totem', 'orchestration', 'totem-codex'));
    const result = resolveSelfAgents(unknownRoot, {});
    expect(result.source).toBe('dirs');
    expect(result.agents).toEqual(['totem-codex']);
  });

  it('unions dirs with the basename map — a map sibling without a dir stays visible (partial-dir clone)', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    mkDir(path.join(totemRoot, '.totem', 'orchestration', 'totem-codex'));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('dirs+map');
    expect(result.agents).toEqual(['totem-claude', 'totem-codex', 'totem-gemini']);
  });

  it("reports source 'dirs' when the map contributes nothing novel", () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    mkOrchestrationTree(totemRoot, 'totem-claude', 'all');
    mkOrchestrationTree(totemRoot, 'totem-gemini', ['outbox']);
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('dirs');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('falls back to the map when the orchestration dir exists but holds no seat dirs', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    mkDir(path.join(totemRoot, '.totem', 'orchestration'));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('map');
    expect(result.agents).toEqual(['totem-claude', 'totem-gemini']);
  });

  it('env still shadows the dirs layer entirely', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    mkDir(path.join(totemRoot, '.totem', 'orchestration', 'totem-codex'));
    const result = resolveSelfAgents(totemRoot, { TOTEM_SELF_AGENT: 'env-agent' });
    expect(result.source).toBe('env');
    expect(result.agents).toEqual(['env-agent']);
  });

  it('excludes dot/underscore-prefixed, unsafe-named, and file (non-dir) entries from the dirs layer', () => {
    const unknownRoot = mkDir(path.join(tmpRoot, 'plain-repo'));
    const orchDir = mkDir(path.join(unknownRoot, '.totem', 'orchestration'));
    mkDir(path.join(orchDir, 'real-seat'));
    mkDir(path.join(orchDir, '_broadcast'));
    mkDir(path.join(orchDir, '.hidden'));
    mkDir(path.join(orchDir, 'two words'));
    // totem-context: test fixture only — config.json here is a stray FILE proving the isDirectory filter, not a host_agents override (it would have to parse to matter, and the dirs-layer test wants it ignored).
    fs.writeFileSync(path.join(orchDir, 'stray-file.md'), '');
    const result = resolveSelfAgents(unknownRoot, {});
    expect(result.source).toBe('dirs');
    expect(result.agents).toEqual(['real-seat']);
  });

  it('resolver purity: a seat dir created between two calls is visible to the second (no caching)', () => {
    const unknownRoot = mkDir(path.join(tmpRoot, 'plain-repo'));
    mkDir(path.join(unknownRoot, '.totem', 'orchestration', 'first-seat'));
    const before = resolveSelfAgents(unknownRoot, {});
    expect(before.agents).toEqual(['first-seat']);
    mkDir(path.join(unknownRoot, '.totem', 'orchestration', 'second-seat'));
    const after = resolveSelfAgents(unknownRoot, {});
    expect(after.agents).toEqual(['first-seat', 'second-seat']);
  });
});

// ─── resolveSelfAgents — config warn-shape (mmnto-ai/totem#2141) ───────────

describe('resolveSelfAgents — config warn-shape (mmnto-ai/totem#2141)', () => {
  it('config keeps replace semantics but WARNS when it omits a present seat dir, naming the seat', () => {
    // The silent-unbind class: totem-codex is dir-registered, config hides it
    // from mail while totem-status's additive display still shows it bound.
    // Replace semantics are the shipped contract; the suppression must be loud.
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['totem-claude'] }));
    mkDir(path.join(totemRoot, '.totem', 'orchestration', 'totem-codex'));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['totem-claude']);
    expect(result.warnings).toBeDefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toContain('totem-codex');
  });

  it('config covering every present seat dir carries no warnings', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['totem-claude', 'totem-codex'] }));
    mkDir(path.join(totemRoot, '.totem', 'orchestration', 'totem-codex'));
    mkOrchestrationTree(totemRoot, 'totem-claude', 'all');
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.warnings).toBeUndefined();
  });

  it('config with no seat dirs present carries no warnings (nothing omitted)', () => {
    const totemRoot = mkDir(path.join(tmpRoot, 'totem'));
    writeConfig(totemRoot, JSON.stringify({ host_agents: ['custom-claude'] }));
    const result = resolveSelfAgents(totemRoot, {});
    expect(result.source).toBe('config');
    expect(result.agents).toEqual(['custom-claude']);
    expect(result.warnings).toBeUndefined();
  });
});

// ─── knownCohortAgents — workspace discovery (mmnto-ai/totem#2141) ─────────

describe('knownCohortAgents — workspace discovery (mmnto-ai/totem#2141)', () => {
  it('zero-arg stays exactly the legacy map flatten (no dir contributions)', () => {
    mkDir(path.join(tmpRoot, 'any-repo', '.totem', 'orchestration', 'totem-codex'));
    const agents = knownCohortAgents();
    expect(agents).not.toContain('totem-codex');
  });

  it('with workspace, a dir-registered seat in ANY immediate repo is known (union with the map)', () => {
    mkDir(path.join(tmpRoot, 'any-repo', '.totem', 'orchestration', 'totem-codex'));
    const agents = knownCohortAgents(tmpRoot);
    expect(agents).toContain('totem-codex');
    expect(agents).toContain('totem-claude');
    expect(agents).toContain('strategy-claude');
    // Sorted + deduplicated contract.
    expect(agents).toEqual([...new Set(agents)].sort());
  });

  it('traversal stays one-level: a nested repo two levels down is NOT discovered (codex F4)', () => {
    mkDir(path.join(tmpRoot, 'wrapper', 'nested-repo', '.totem', 'orchestration', 'deep-seat'));
    const agents = knownCohortAgents(tmpRoot);
    expect(agents).not.toContain('deep-seat');
  });

  it('skips dot-prefixed and node_modules workspace entries', () => {
    mkDir(path.join(tmpRoot, '.hidden-repo', '.totem', 'orchestration', 'hidden-seat'));
    mkDir(path.join(tmpRoot, 'node_modules', '.totem', 'orchestration', 'module-seat'));
    const agents = knownCohortAgents(tmpRoot);
    expect(agents).not.toContain('hidden-seat');
    expect(agents).not.toContain('module-seat');
  });

  it('degrades to the map flatten when the workspace is unreadable (inv6 — advisory only)', () => {
    const agents = knownCohortAgents(path.join(tmpRoot, 'does-not-exist'));
    expect(agents).toEqual([...knownCohortAgents()].sort());
  });
});
