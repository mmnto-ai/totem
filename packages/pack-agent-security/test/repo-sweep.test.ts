import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CompiledRule,
  CompiledRulesFileSchema,
  matchAstGrepPattern,
  matchesGlob,
  readJsonSafe,
} from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const manifest = readJsonSafe(path.join(PACK_ROOT, 'compiled-rules.json'), CompiledRulesFileSchema);

// ─── Sweep targets ──────────────────────────────────────
//
// The rules apply to source code under packages/. We walk that tree, skip
// node_modules and build outputs, and let each rule's own fileGlobs decide
// whether it applies to a given file. The pack is dogfood: its own fixture
// files under packages/pack-agent-security/test/fixtures/ are excluded by
// every rule's `!**/test/**` glob, so the sweep cannot trip on them.

const SWEEP_DIRS = ['packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
const SWEEP_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// totem-context: the pack's own fixtures intentionally exercise the
// attack patterns the rules flag. They live under the pack's test/
// directory, but the rule globs' `!**/test/**` does not catch nested
// test directories (matchesGlob treats `**/X/**` as "top-level X only").
// Skip the pack's fixture tree at walk time rather than bloating every
// rule's fileGlobs with a pack-specific exclusion.
const SKIP_PATH_PREFIXES = ['packages/pack-agent-security/test'];

function walkDir(dir: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // CR-5 finding on #1521: don't swallow fs errors. A silent return here
    // would turn the repo-wide FP sweep into a false-negative generator —
    // if a directory becomes unreadable mid-sweep, the sweep would still
    // "pass" on a partial scan. Fail loud with the offending path.
    throw new Error(
      `repo-sweep: failed to read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkDir(abs, acc);
    } else if (ent.isFile() && SWEEP_EXTS.has(path.extname(ent.name))) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
      if (SKIP_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix + '/'))) continue;
      acc.push(rel);
    }
  }
}

function collectTargetFiles(): string[] {
  const out: string[] = [];
  for (const top of SWEEP_DIRS) walkDir(path.join(REPO_ROOT, top), out);
  return out;
}

function fileMatchesRuleGlobs(file: string, rule: CompiledRule): boolean {
  const globs = rule.fileGlobs ?? [];
  if (globs.length === 0) return true;
  const positive = globs.filter((g) => !g.startsWith('!'));
  const negative = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
  const posOk = positive.length === 0 || positive.some((g) => matchesGlob(file, g));
  const negOk = negative.some((g) => matchesGlob(file, g));
  return posOk && !negOk;
}

function extForFile(file: string): string {
  return path.extname(file);
}

type Violation = {
  hash: string;
  file: string;
  line: number;
};

function sweep(): Violation[] {
  const files = collectTargetFiles();
  const out: Violation[] = [];
  for (const rule of manifest.rules) {
    if (rule.engine !== 'ast-grep') continue;
    const pattern = rule.astGrepYamlRule ?? rule.astGrepPattern;
    if (!pattern) continue;
    for (const file of files) {
      if (!fileMatchesRuleGlobs(file, rule)) continue;
      const abs = path.join(REPO_ROOT, file);
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch (err) {
        // CR-5: fail loud on unreadable files rather than dropping them from
        // the sweep. A silent drop would let a missing file mask a rule hit.
        throw new Error(
          `repo-sweep: failed to read file ${abs}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const lineCount = content.split('\n').length;
      const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
      const matches = matchAstGrepPattern(content, extForFile(file), pattern, lineNumbers);
      for (const m of matches) {
        out.push({ hash: rule.lessonHash, file, line: m.lineNumber });
      }
    }
  }
  return out;
}

// ─── Allowlist ──────────────────────────────────────────
//
// Known-legitimate uses of the flagged primitives inside Totem's own source
// tree. Each entry records the hash (which rule fires), the file (what path),
// the expected match count (CR-6 finding on #1521 — catches new matches in
// already-allowed files instead of silently blessing them), and the reason
// (why these calls are legit here).
//
// When a legitimate call site is added or removed, update the `expectedCount`
// accordingly. When the count diverges from expected, the sweep fails with a
// diff that identifies the new or missing line numbers.
//
// When adding an entry, also update the pack's README coverage notes so
// consumers are aware that these sites are project-local exceptions rather
// than pack-template holes.

type AllowEntry = {
  hash: string;
  file: string;
  expectedCount: number;
  reason: string;
};

const ALLOWLIST: AllowEntry[] = [
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/core/src/sys/exec.ts',
    expectedCount: 1,
    reason:
      'The safeExec helper itself. Wraps cross-spawn.sync to provide the shell-injection-safe primitive the rest of the CLI uses. All consumer spawn surfaces route through this.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/index.ts',
    expectedCount: 1,
    reason:
      'Capability probe (`gh --version`) to decide whether GitHub-CLI-backed commands are available. Literal target, no user input.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/doctor.ts',
    expectedCount: 7,
    reason:
      '`totem doctor` invokes `spawnSync` to run git plumbing (rev-parse, ls-files, checkout) for hook installation, secrets-file checks, and manifest recovery. Literal targets, fixed args.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/add-lesson.ts',
    expectedCount: 1,
    reason:
      'Uses the safeExec helper (imported as `exec`) to shell out to git for metadata during lesson creation. Literal git subcommands only.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/extract-local.ts',
    expectedCount: 3,
    reason:
      'safeExec alias (`{ safeExec: exec }`) used for diff and commit-history retrieval during lesson extraction. Literal git subcommands with branch-name args under Totem control.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/extract-pr.ts',
    expectedCount: 1,
    reason: 'Same safeExec alias pattern for PR-backed lesson extraction.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/extract-scan.ts',
    expectedCount: 1,
    reason: 'Same safeExec alias pattern for scan-mode extraction.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/handoff.ts',
    expectedCount: 1,
    reason: 'safeExec alias used to read commit history during end-of-session journal scaffolding.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/commands/lesson.ts',
    expectedCount: 1,
    reason: 'safeExec alias used for git plumbing when listing/inspecting lessons.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/orchestrators/orchestrator.ts',
    expectedCount: 1,
    reason: 'safeExec alias for git state probes inside the LLM orchestration pipeline.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/cli/src/orchestrators/shell-orchestrator.ts',
    expectedCount: 2,
    reason:
      'Windows-only process-tree cleanup via `spawn(taskkill, [...])`. Literal target, fixed args. Required because Node child_process does not propagate SIGTERM on Windows.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/mcp/src/tools/add-lesson.ts',
    expectedCount: 2,
    reason: 'Same Windows taskkill cleanup pattern as shell-orchestrator.ts.',
  },
  {
    hash: 'c2c09301bb56a02b',
    file: 'packages/mcp/src/tools/verify-execution.ts',
    expectedCount: 3,
    reason: 'Same Windows taskkill cleanup pattern via execFileSync.',
  },
];

function keyFor(hash: string, file: string): string {
  return `${hash}|${file}`;
}

// ─── Tests ──────────────────────────────────────────────

describe('@totem/pack-agent-security Totem-repo FP sweep', () => {
  const violations = sweep();

  // Per-file tallies for count-based allowlist comparison (CR-6).
  const countsByKey = new Map<string, { lines: number[]; hash: string; file: string }>();
  for (const v of violations) {
    const key = keyFor(v.hash, v.file);
    const entry = countsByKey.get(key) ?? { lines: [], hash: v.hash, file: v.file };
    entry.lines.push(v.line);
    countsByKey.set(key, entry);
  }
  const allowByKey = new Map(ALLOWLIST.map((e) => [keyFor(e.hash, e.file), e]));

  it('does not surface any rule violations outside the documented allowlist', () => {
    const unexpectedKeys: string[] = [];
    for (const [key, { hash, file, lines }] of countsByKey) {
      if (!allowByKey.has(key)) {
        unexpectedKeys.push(
          `  ${hash}  ${file}  (${lines.length} match${lines.length === 1 ? '' : 'es'} at line${lines.length === 1 ? '' : 's'} ${lines.join(', ')})`,
        );
      }
    }
    if (unexpectedKeys.length > 0) {
      throw new Error(
        `Unexpected rule violations in Totem source (add to ALLOWLIST with justification, or narrow the rule):\n${unexpectedKeys.join('\n')}`,
      );
    }
    expect(unexpectedKeys).toEqual([]);
  });

  it('every allowlisted (hash, file) pair still produces the expected number of matches', () => {
    // CR-6 finding on #1521: file-level allowlisting masks regressions. If a
    // new suspicious call is added to an allowlisted file, the hit count
    // changes and this test fails, naming the file and showing the delta.
    const deltas: string[] = [];
    for (const entry of ALLOWLIST) {
      const key = keyFor(entry.hash, entry.file);
      const actual = countsByKey.get(key);
      const actualCount = actual?.lines.length ?? 0;
      if (actualCount !== entry.expectedCount) {
        const detail = actual
          ? `expected ${entry.expectedCount}, got ${actualCount} (actual lines: ${actual.lines.join(', ')})`
          : `expected ${entry.expectedCount}, got ${actualCount}`;
        deltas.push(`  ${entry.hash}  ${entry.file}: ${detail}`);
      }
    }
    if (deltas.length > 0) {
      throw new Error(
        `Allowlist count drift (update expectedCount, or investigate the new/removed call site):\n${deltas.join('\n')}`,
      );
    }
    expect(deltas).toEqual([]);
  });

  it('each allowlist entry references a hash that exists in the pack', () => {
    const validHashes = new Set(manifest.rules.map((r) => r.lessonHash));
    for (const entry of ALLOWLIST) {
      expect(
        validHashes.has(entry.hash),
        `Allowlist hash ${entry.hash} does not match any rule in the pack`,
      ).toBe(true);
    }
  });
});
