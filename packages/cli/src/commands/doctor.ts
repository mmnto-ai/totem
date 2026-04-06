import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import pc from 'picocolors';

import { resolveGitRoot } from '../git.js';
import { CONFIG_FILES } from '../utils.js';

// ─── Types ──────────────────────────────────────────────

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface DiagnosticResult {
  name: string;
  status: CheckStatus;
  message: string;
  remediation?: string;
}

// ─── Secret leak patterns ───────────────────────────────

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{20,}/,
  /sk-ant-[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /ghu_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
];

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /<YOUR_KEY>/i,
  /your_token_here/i,
  /sk-your-key-here/i,
  /<your[_-].*?>/i,
  /your[_-]api[_-]key/i,
  /replace[_-]with[_-]/i,
  /placeholder/i,
  /xxx+/i,
];

// ─── Individual checks ──────────────────────────────────

export function checkConfig(cwd: string): DiagnosticResult {
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    if (fs.existsSync(candidate)) {
      return {
        name: 'Config',
        status: 'pass',
        message: `${file} found`,
      };
    }
  }
  return {
    name: 'Config',
    status: 'fail',
    message: 'No config file found',
    remediation: 'totem init',
  };
}

export function checkCompiledRules(cwd: string, totemDir = '.totem'): DiagnosticResult {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    return {
      name: 'Compiled Rules',
      status: 'warn',
      message: 'compiled-rules.json missing',
      remediation: 'totem compile',
    };
  }

  try {
    const content = fs.readFileSync(rulesPath, 'utf-8');
    const parsed = JSON.parse(content) as { rules?: unknown[] };
    // Handle both { version, rules } wrapper and bare array formats
    const rules = Array.isArray(parsed?.rules)
      ? parsed.rules
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];
    return {
      name: 'Compiled Rules',
      status: 'pass',
      message: `${rules.length} rules loaded`,
    };
  } catch {
    return {
      name: 'Compiled Rules',
      status: 'warn',
      message: 'compiled-rules.json unreadable',
      remediation: 'totem compile',
    };
  }
}

export function checkGitHooks(cwd: string): DiagnosticResult {
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    return {
      name: 'Git Hooks',
      status: 'skip',
      message: 'Not a git repository',
    };
  }

  let hooksDir: string;
  try {
    const resolved = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: gitRoot,
      encoding: 'utf-8',
    });
    hooksDir =
      resolved.status === 0 && resolved.stdout.trim()
        ? path.resolve(gitRoot, resolved.stdout.trim())
        : path.join(gitRoot, '.git', 'hooks');
  } catch {
    hooksDir = path.join(gitRoot, '.git', 'hooks');
  }
  const markers: { file: string; marker: string }[] = [
    { file: 'pre-commit', marker: '[totem] pre-commit hook' },
    { file: 'pre-push', marker: '[totem] pre-push hook' },
    { file: 'post-merge', marker: '[totem] post-merge hook' },
    { file: 'post-checkout', marker: '[totem] post-checkout hook' },
  ];

  let installed = 0;
  const missing: string[] = [];

  for (const { file, marker } of markers) {
    const hookPath = path.join(hooksDir, file);
    if (fs.existsSync(hookPath)) {
      try {
        const content = fs.readFileSync(hookPath, 'utf-8');
        if (content.includes(marker)) {
          installed++;
          continue;
        }
      } catch {
        // Fall through to missing
      }
    }
    missing.push(file);
  }

  if (missing.length === 0) {
    return {
      name: 'Git Hooks',
      status: 'pass',
      message: `All ${markers.length} hooks installed`,
    };
  }

  return {
    name: 'Git Hooks',
    status: 'warn',
    message: `${installed}/${markers.length} hooks installed (missing: ${missing.join(', ')})`,
    remediation: 'totem hooks',
  };
}

/** Check if a config file content has an embedding provider configured. */
function hasEmbeddingProvider(content: string): boolean {
  return /provider:\s*['"]?(openai|gemini|ollama)['"]?/.test(content);
}

/** Find and read the first totem config file. Returns [path, content] or null. */
function readConfigFile(cwd: string): [string, string] | null {
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    if (fs.existsSync(candidate)) {
      try {
        return [candidate, fs.readFileSync(candidate, 'utf-8')];
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function checkEmbeddingConfig(cwd: string): DiagnosticResult {
  const configResult = readConfigFile(cwd);
  if (!configResult) {
    return {
      name: 'Embedding',
      status: 'skip',
      message: 'No config (skipped)',
    };
  }

  const [, content] = configResult;

  if (!hasEmbeddingProvider(content)) {
    return {
      name: 'Embedding',
      status: 'warn',
      message: 'No embedding configured (Lite tier)',
    };
  }

  try {
    // Detect which provider and check for API keys
    const isOpenAI = /provider:\s*['"]?openai['"]?/.test(content);
    const isGemini = /provider:\s*['"]?gemini['"]?/.test(content);
    const isOllama = /provider:\s*['"]?ollama['"]?/.test(content);

    // Read .env for key checks
    let envContent = '';
    try {
      const envPath = path.join(cwd, '.env');
      if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf-8');
    } catch {
      // .env unreadable — proceed with env vars only
    }

    const hasEnvKey = (key: string) =>
      !!(process.env[key] && /\S/.test(process.env[key]!)) ||
      new RegExp(`^\\s*${key}\\s*=\\s*\\S+`, 'm').test(envContent);

    if (isOpenAI) {
      if (hasEnvKey('OPENAI_API_KEY')) {
        return {
          name: 'Embedding',
          status: 'pass',
          message: 'openai (text-embedding-3-small)',
        };
      }
      return {
        name: 'Embedding',
        status: 'fail',
        message: 'OpenAI configured but OPENAI_API_KEY missing',
        remediation: 'Set OPENAI_API_KEY in your .env file',
      };
    }

    if (isGemini) {
      if (hasEnvKey('GEMINI_API_KEY') || hasEnvKey('GOOGLE_API_KEY')) {
        return {
          name: 'Embedding',
          status: 'pass',
          message: 'gemini (gemini-embedding-2-preview)',
        };
      }
      return {
        name: 'Embedding',
        status: 'fail',
        message: 'Gemini configured but API key missing',
        remediation: 'Set GEMINI_API_KEY or GOOGLE_API_KEY in your .env file',
      };
    }

    if (isOllama) {
      return {
        name: 'Embedding',
        status: 'pass',
        message: 'ollama (nomic-embed-text)',
      };
    }

    return {
      name: 'Embedding',
      status: 'warn',
      message: 'No embedding configured (Lite tier)',
    };
  } catch {
    return {
      name: 'Embedding',
      status: 'skip',
      message: 'Could not read config',
    };
  }
}

export function checkIndex(cwd: string, lanceDir = '.lancedb'): DiagnosticResult {
  const configResult = readConfigFile(cwd);
  if (!configResult || !hasEmbeddingProvider(configResult[1])) {
    return {
      name: 'Index',
      status: 'skip',
      message: 'Lite tier (no embedding)',
    };
  }

  const lanceDbPath = path.join(cwd, lanceDir);
  if (!fs.existsSync(lanceDbPath)) {
    return {
      name: 'Index',
      status: 'warn',
      message: `${lanceDir}/ missing`,
      remediation: 'totem sync',
    };
  }

  try {
    const entries = fs.readdirSync(lanceDbPath);
    if (entries.length === 0) {
      return {
        name: 'Index',
        status: 'warn',
        message: `${lanceDir}/ is empty`,
        remediation: 'totem sync',
      };
    }
  } catch {
    return {
      name: 'Index',
      status: 'warn',
      message: `${lanceDir}/ unreadable`,
      remediation: 'totem sync',
    };
  }

  return {
    name: 'Index',
    status: 'pass',
    message: `${lanceDir}/ exists`,
  };
}

export async function checkSecretLeaks(
  cwd: string,
  totemDir = '.totem',
): Promise<DiagnosticResult> {
  const filesToScan: string[] = [];

  // Collect files to scan
  const candidates = ['CLAUDE.md', '.cursorrules'];
  for (const file of candidates) {
    const fullPath = path.join(cwd, file);
    if (fs.existsSync(fullPath)) {
      filesToScan.push(fullPath);
    }
  }

  // Scan .totem/lessons/*.md
  const lessonsDir = path.join(cwd, totemDir, 'lessons');
  if (fs.existsSync(lessonsDir)) {
    try {
      const entries = fs.readdirSync(lessonsDir);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          filesToScan.push(path.join(lessonsDir, entry));
        }
      }
    } catch {
      // lessons dir unreadable — skip
    }
  }

  if (filesToScan.length === 0) {
    return {
      name: 'Secret Scan',
      status: 'pass',
      message: 'No files to scan',
    };
  }

  // Load user-defined custom secrets (dynamic import to avoid top-level @mmnto/totem dep)
  const { loadCustomSecrets, compileCustomSecrets } = await import('@mmnto/totem');
  const customSecrets = loadCustomSecrets(cwd, totemDir);
  const customPatterns = compileCustomSecrets(customSecrets);

  const allPatterns = [...SECRET_PATTERNS, ...customPatterns];
  const leaks: string[] = [];

  for (const filePath of filesToScan) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const pattern of allPatterns) {
        const matches = content.match(new RegExp(pattern.source, 'g'));
        if (matches) {
          for (const match of matches) {
            // Check if this looks like a placeholder
            const isPlaceholder = PLACEHOLDER_PATTERNS.some((pp) => pp.test(match));
            if (!isPlaceholder) {
              const rel = path.relative(cwd, filePath);
              leaks.push(`${rel}: ${match.slice(0, 8)}...`);
            }
          }
        }
      }
    } catch {
      // File unreadable — skip
    }
  }

  if (leaks.length > 0) {
    return {
      name: 'Secret Scan',
      status: 'fail',
      message: `${leaks.length} potential leaked key(s) found`,
      remediation: 'Rotate keys immediately and remove from tracked files',
    };
  }

  return {
    name: 'Secret Scan',
    status: 'pass',
    message: 'No leaked keys detected',
  };
}

export function checkSecretsFileTracked(cwd: string, totemDir = '.totem'): DiagnosticResult {
  const secretsPath = path.join(totemDir, 'secrets.json');
  try {
    const result = spawnSync('git', ['ls-files', '--recurse-submodules', secretsPath], {
      cwd,
      encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    const output = (result.stdout ?? '').trim();
    if (output.length > 0) {
      return {
        name: 'Secrets File Security',
        status: 'fail',
        message: `${secretsPath} is tracked by git — secrets may be exposed`,
        remediation: `Run: git rm --cached ${secretsPath}`,
      };
    }
  } catch {
    // git not available or not a repo — skip
  }
  return {
    name: 'Secrets File Security',
    status: 'pass',
    message: 'secrets.json is not tracked by git',
  };
}

// ─── Upgrade candidate check (mmnto/totem#1131) ────────────────────

/**
 * Pure helper: scan compiled rules + metrics and return structured upgrade candidates.
 * Used by both `checkUpgradeCandidates` (read-only diagnostic) and `runSelfHealing`
 * (auto-recompile phase). Returns null if rules/metrics cannot be loaded.
 *
 * IMPORTANT: Uses `contextCounts` (per-context match buckets), NOT `triggerCount`
 * (the rolled-up total). `triggerCount` includes ALL matches, not just code matches.
 */
export async function findUpgradeCandidates(
  cwd: string,
  totemDir = '.totem',
): Promise<UpgradeCandidate[] | null> {
  const totemDirAbs = path.join(cwd, totemDir);
  const rulesPath = path.join(totemDirAbs, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) return null;

  try {
    // Dynamic import to avoid top-level @mmnto/totem dep (mirrors GC phase)
    const { loadCompiledRulesFile, loadRuleMetrics } = await import('@mmnto/totem');
    const rulesFile = loadCompiledRulesFile(rulesPath);
    const metricsFile = loadRuleMetrics(totemDirAbs);

    const candidates: UpgradeCandidate[] = [];
    for (const rule of rulesFile.rules) {
      // Only regex rules carry trustworthy non-code telemetry. `ast-grep` rules
      // are already structural; the legacy `ast` (Tree-sitter) engine does not
      // populate `astContext`, so its hits land in the `unknown` bucket and
      // cannot be reasoned about here.
      if (rule.engine !== 'regex') continue;

      const metric = metricsFile.rules[rule.lessonHash];
      if (!metric || !metric.contextCounts) continue;

      // Exclude `unknown` from both numerator and denominator — it represents
      // historical / unclassified telemetry (pre-context-aware hits, or seeding
      // via `triggerCount - 1`) and is not evidence of non-code leakage.
      const cc = metric.contextCounts;
      const classifiedTotal = cc.code + cc.string + cc.comment + cc.regex;
      if (classifiedTotal < MIN_CONTEXT_EVENTS) continue;

      const nonCodeRatio = (cc.string + cc.comment + cc.regex) / classifiedTotal;
      if (nonCodeRatio > NON_CODE_THRESHOLD) {
        candidates.push({
          lessonHash: rule.lessonHash,
          heading: rule.lessonHeading ?? rule.lessonHash,
          engine: rule.engine,
          total: classifiedTotal,
          codeCount: cc.code,
          nonCodeRatio,
        });
      }
    }
    // Highest non-code ratio first for human readability
    return candidates.sort((a, b) => b.nonCodeRatio - a.nonCodeRatio);
  } catch {
    return null;
  }
}

/**
 * Find regex/ast rules whose telemetry shows >NON_CODE_THRESHOLD of matches landing
 * in non-code contexts (strings, comments, regex literals). These are good candidates
 * for being upgraded to structural ast-grep patterns via `totem compile --upgrade`.
 */
export async function checkUpgradeCandidates(
  cwd: string,
  totemDir = '.totem',
): Promise<DiagnosticResult> {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    return {
      name: 'Upgrade Candidates',
      status: 'skip',
      message: 'compiled-rules.json missing',
    };
  }

  const candidates = await findUpgradeCandidates(cwd, totemDir);
  if (candidates === null) {
    return {
      name: 'Upgrade Candidates',
      status: 'skip',
      message: 'Could not analyze rules',
    };
  }

  if (candidates.length === 0) {
    return {
      name: 'Upgrade Candidates',
      status: 'pass',
      message: 'No regex rules exceed non-code threshold',
    };
  }

  const summary = candidates
    .map(
      (c) =>
        `${c.lessonHash} (${c.engine}, ${(c.nonCodeRatio * 100).toFixed(0)}% non-code, ${c.total} matches)`,
    )
    .join(', ');

  const firstHash = candidates[0]!.lessonHash;
  return {
    name: 'Upgrade Candidates',
    status: 'warn',
    message: `${candidates.length} rule(s) firing in non-code contexts: ${summary}`,
    remediation: `Run \`totem compile --upgrade ${firstHash}\` to re-compile through Claude Sonnet with telemetry guidance.`,
  };
}

// ─── Output formatting ──────────────────────────────────

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case 'pass':
      return pc.green('\u2713');
    case 'warn':
      return pc.yellow('!');
    case 'fail':
      return pc.red('\u2717');
    case 'skip':
      return pc.dim('-');
  }
}

function statusColor(status: CheckStatus, text: string): string {
  switch (status) {
    case 'pass':
      return pc.green(text);
    case 'warn':
      return pc.yellow(text);
    case 'fail':
      return pc.red(text);
    case 'skip':
      return pc.dim(text);
  }
}

function formatResult(result: DiagnosticResult): string {
  const icon = statusIcon(result.status);
  const name = result.name.padEnd(18);
  const msg = statusColor(result.status, result.message);
  let line = `  ${icon} ${name} ${msg}`;
  if (result.remediation && (result.status === 'warn' || result.status === 'fail')) {
    line += pc.dim(` → ${result.remediation}`);
  }
  return line;
}

// ─── Self-healing constants ─────────────────────────────

/** Bypass rate above which a rule is considered "struggling" and eligible for downgrade. */
export const BYPASS_THRESHOLD = 0.3;

/** Minimum total events (triggers + bypasses) required before acting on a rule. */
export const MIN_EVENTS = 5;

// ─── Upgrade-candidate constants (mmnto/totem#1131) ────────────────

/** Non-code match ratio above which a regex/ast rule is flagged for ast-grep upgrade. */
export const NON_CODE_THRESHOLD = 0.2; // 20%+ non-code matches → upgrade candidate

/** Minimum total context events required before flagging a rule as an upgrade candidate. */
export const MIN_CONTEXT_EVENTS = 5;

// ─── Upgrade-candidate types ────────────────────────────

export interface UpgradeCandidate {
  lessonHash: string;
  heading: string;
  engine: 'regex' | 'ast';
  total: number;
  codeCount: number;
  nonCodeRatio: number;
}

// ─── Types ──────────────────────────────────────────────

export interface DoctorOptions {
  pr?: boolean;
}

// ─── Self-healing flow ──────────────────────────────────

export async function runSelfHealing(cwd: string): Promise<void> {
  // Self-healing creates a branch, commits, and opens a PR via the GitHub CLI.
  // Verify gh is installed up front — otherwise we would fail deep inside the
  // flow with an opaque ENOENT after already doing diagnostic work.
  const ghCheck = spawnSync('gh', ['--version'], { stdio: 'ignore', timeout: 3000 });
  if (ghCheck.status !== 0 || ghCheck.error) {
    console.error(
      pc.red(
        '\n[Auto-Healing] The --pr flow requires the GitHub CLI (gh). Install: https://cli.github.com',
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Load config to get totemDir
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');

  console.error(`\n${pc.cyan('[Auto-Healing]')} Analyzing Trap Ledger...`);

  const { analyzeLedger } = await import('./ledger-analyzer.js');
  const stats = await analyzeLedger(totemDir, (msg) => console.error(pc.dim(`  ${msg}`)));

  // ─── Guard: abort if compiled-rules.json has uncommitted changes ──
  let gitDirty = false;
  try {
    const gitResult = spawnSync('git', ['status', '--porcelain', rulesPath], {
      cwd,
      encoding: 'utf-8',
    });
    const gitStatus = (gitResult.stdout ?? '').trim();
    if (gitStatus) {
      console.error(
        pc.red('  ERROR: compiled-rules.json has uncommitted changes. Commit or stash first.'),
      );
      gitDirty = true;
    }
  } catch {
    // Not a git repo or git not available — proceed anyway
  }

  // ─── Downgrade phase: demote noisy rules ─────────────
  const downgraded: Array<{ ruleId: string; heading: string; rate: number }> = [];

  if (stats.size === 0) {
    console.error(
      pc.dim('  No ledger data. Run totem lint with some // totem-context: overrides first.'),
    );
  } else {
    // Find struggling rules
    const struggling = [...stats.entries()]
      .filter(([, s]) => s.bypassRate > BYPASS_THRESHOLD && s.totalEvents >= MIN_EVENTS)
      .sort((a, b) => b[1].bypassRate - a[1].bypassRate);

    if (struggling.length === 0) {
      console.error(pc.green('  No rules exceed the 30% bypass threshold. All healthy.'));
    } else {
      console.error(
        `  Found ${struggling.length} rule(s) exceeding ${BYPASS_THRESHOLD * 100}% bypass rate:\n`,
      );

      if (!gitDirty) {
        // Downgrade each struggling rule
        const { downgradeRuleToWarning } = await import('./rule-mutator.js');

        for (const [ruleId, ruleStats] of struggling) {
          const result = downgradeRuleToWarning(rulesPath, ruleId);
          if (result.downgraded) {
            const pct = (ruleStats.bypassRate * 100).toFixed(0);
            console.error(
              `  ${pc.yellow('↓')} ${result.ruleHeading ?? ruleId} — ${pct}% bypass rate (${ruleStats.bypassCount}/${ruleStats.totalEvents} events)`,
            );
            downgraded.push({
              ruleId,
              heading: result.ruleHeading ?? ruleId,
              rate: ruleStats.bypassRate,
            });
          } else {
            console.error(
              pc.dim(`  - ${result.ruleHeading ?? ruleId} — already at warning, skipping`),
            );
          }
        }

        if (downgraded.length > 0) {
          console.error(
            `\n  ${pc.green(`Downgraded ${downgraded.length} rule(s) from error → warning.`)}`,
          );
        }
      }
    }
  }

  // ─── GC phase: archive stale rules ───────────────────
  const { shouldArchiveRule } = await import('./gc-rules.js');
  let archivedCount = 0;

  // GC is opt-in: only runs when garbageCollection is explicitly configured
  const gcConfig = config.garbageCollection;
  if (gcConfig && gcConfig.enabled !== false && !gitDirty) {
    console.error(`\n${pc.cyan('[Auto-Healing]')} Checking for stale rules to archive...`);

    const fs = await import('node:fs');
    if (!fs.existsSync(rulesPath)) {
      console.error(pc.dim('  No compiled-rules.json found. Skipping GC.'));
    } else {
      const {
        loadCompiledRulesFile,
        saveCompiledRulesFile,
        loadRuleMetrics,
      } = // totem-context: verified — both functions exist in core/compiler.ts and core/index.ts
        await import('@mmnto/totem');
      const rulesFile = loadCompiledRulesFile(rulesPath);
      const metricsFile = loadRuleMetrics(totemDir); // returns { version, rules: Record<hash, RuleMetric> }

      for (const rule of rulesFile.rules) {
        const ruleMetrics = metricsFile.rules[rule.lessonHash];
        const reason = shouldArchiveRule(
          {
            lessonHash: rule.lessonHash,
            createdAt: rule.createdAt,
            compiledAt: rule.compiledAt,
            category: rule.category,
            status: rule.status ?? 'active',
          },
          ruleMetrics
            ? { triggerCount: ruleMetrics.triggerCount, suppressCount: ruleMetrics.suppressCount }
            : undefined,
          gcConfig,
        );

        if (reason) {
          rule.status = 'archived';
          rule.archivedReason = reason;
          archivedCount++;
          console.error(`  ${pc.dim('🗃')} ${rule.lessonHeading ?? rule.lessonHash} — ${reason}`);
        }
      }

      if (archivedCount > 0) {
        saveCompiledRulesFile(rulesPath, rulesFile);
        console.error(`\n  ${pc.green(`Archived ${archivedCount} stale rule(s).`)}`);
      } else {
        console.error(pc.green('  No stale rules found. All active rules have recent activity.'));
      }
    } // end fs.existsSync guard
  }

  // ─── Upgrade phase: re-compile flagged rules through Sonnet (mmnto/totem#1131) ─
  const upgraded: UpgradeCandidate[] = [];

  if (!gitDirty) {
    console.error(`\n${pc.cyan('[Auto-Healing]')} Checking for ast-grep upgrade candidates...`);
    const candidates = await findUpgradeCandidates(cwd, config.totemDir);

    if (candidates === null || candidates.length === 0) {
      console.error(pc.dim('  No rules flagged for upgrade.'));
    } else {
      console.error(`  Found ${candidates.length} upgrade candidate(s). Re-compiling...`);

      // Call compileCommand directly (avoids shelling out — works regardless of pnpm/npm/global install).
      // Each call mutates compiled-rules.json in-place.
      const { compileCommand } = await import('./compile.js');
      for (const cand of candidates) {
        try {
          await compileCommand({ upgrade: cand.lessonHash });
          upgraded.push(cand);
          console.error(
            `  ${pc.green('↑')} ${cand.heading} (${(cand.nonCodeRatio * 100).toFixed(0)}% non-code)`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(pc.yellow(`  - ${cand.heading} — upgrade failed: ${msg}`));
        }
      }

      if (upgraded.length > 0) {
        console.error(`\n  ${pc.green(`Upgraded ${upgraded.length} rule(s) via telemetry.`)}`);
      }
    }
  }

  if (downgraded.length === 0 && archivedCount === 0 && upgraded.length === 0) {
    return;
  }

  // Create branch and PR
  const branchName = `totem/auto-healing-${Date.now()}`;

  // Capture current branch so we can restore on failure
  const currentBranchRes = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  const originalBranch = currentBranchRes.error ? null : (currentBranchRes.stdout ?? '').trim();
  let branchCreated = false;

  /** Run a shell command via spawnSync, throw on failure */
  function run(cmd: string, args: string[]): void {
    const res = spawnSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf-8' });
    if (res.error) throw res.error;
    if (res.status !== 0) {
      const stderr = (res.stderr ?? '').trim();
      throw new Error(
        `${cmd} ${args[0]} failed (exit ${res.status})${stderr ? ': ' + stderr : ''}`,
      );
    }
  }

  try {
    run('git', ['checkout', '-b', branchName]);
    branchCreated = true;
    run('git', ['add', rulesPath]);

    // Build commit message
    const parts: string[] = [];
    if (downgraded.length > 0) {
      const ruleList = downgraded
        .map((d) => `- ${d.heading} (${(d.rate * 100).toFixed(0)}% bypass)`)
        .join('\n');
      parts.push(`Downgraded ${downgraded.length} rule(s):\n${ruleList}`);
    }
    if (archivedCount > 0) {
      parts.push(`Archived ${archivedCount} stale rule(s)`);
    }
    if (upgraded.length > 0) {
      const ruleList = upgraded
        .map((u) => `- ${u.heading} (${(u.nonCodeRatio * 100).toFixed(0)}% non-code)`)
        .join('\n');
      parts.push(`Upgraded ${upgraded.length} rule(s) via telemetry diagnostic:\n${ruleList}`);
    }
    const totalChanges = downgraded.length + archivedCount + upgraded.length;
    const commitMsg = `fix: auto-heal ${totalChanges} rule(s)\n\n${parts.join('\n\n')}\n\nGenerated by totem doctor --pr`;

    run('git', ['commit', '-m', commitMsg]);
    run('git', ['push', '-u', 'origin', branchName]);

    // Build PR body
    const prBodyParts = ['## Auto-Healing: Rule Maintenance', ''];

    if (downgraded.length > 0) {
      prBodyParts.push(
        `### Downgrades`,
        '',
        `${downgraded.length} compiled rule(s) exceeded the 30% bypass rate threshold and have been downgraded from \`error\` to \`warning\`.`,
        '',
        '| Rule | Bypass Rate |',
        '|---|---|',
        ...downgraded.map((d) => `| ${d.heading} | ${(d.rate * 100).toFixed(0)}% |`),
        '',
      );
    }

    if (archivedCount > 0) {
      prBodyParts.push(
        `### Archives`,
        '',
        `${archivedCount} stale rule(s) with zero activity past their minimum age have been archived.`,
        '',
      );
    }

    if (upgraded.length > 0) {
      prBodyParts.push(
        `### Upgrades (mmnto/totem#1131)`,
        '',
        `${upgraded.length} rule(s) were re-compiled through Claude Sonnet because telemetry showed >${NON_CODE_THRESHOLD * 100}% of matches landing in non-code contexts.`,
        '',
        '| Rule | Hash | Non-Code Ratio |',
        '|---|---|---|',
        ...upgraded.map(
          (u) => `| ${u.heading} | \`${u.lessonHash}\` | ${(u.nonCodeRatio * 100).toFixed(0)}% |`,
        ),
        '',
      );
    }

    prBodyParts.push(
      'These rules are not deleted (ADR-027). Downgraded rules continue to fire as warnings. Archived rules are skipped during lint but preserved for audit. Upgraded rules retain the same lessonHash but ship with a structural ast-grep pattern.',
      '',
      'Generated by `totem doctor --pr`',
    );

    const prBody = prBodyParts.join('\n');
    const prTitle =
      upgraded.length > 0 && downgraded.length === 0 && archivedCount === 0
        ? `chore(doctor): upgrade ${upgraded.length} rule(s) to ast-grep via telemetry diagnostic`
        : `fix: auto-heal ${totalChanges} rule(s)`;
    run('gh', ['pr', 'create', '--title', prTitle, '--body', prBody]);

    console.error(pc.green(`\n  PR created on branch ${branchName}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`\n  Failed to create PR: ${msg}`));
    if (branchCreated) {
      console.error(
        pc.dim(
          `  Changes are committed on branch ${branchName}. Push manually with: git push -u origin ${branchName}`,
        ),
      );
    } else {
      console.error(
        pc.dim('  The compiled-rules.json changes are in your working tree. Commit manually.'),
      );
    }
  } finally {
    // Only switch back if we created the branch (otherwise we'd change the user's branch)
    if (branchCreated && originalBranch) {
      spawnSync('git', ['checkout', originalBranch], { cwd, stdio: 'pipe' });
    }
  }
}

// ─── Main command ───────────────────────────────────────

export async function doctorCommand(options: DoctorOptions = {}): Promise<DiagnosticResult[]> {
  const cwd = process.cwd();

  console.error(`${pc.cyan('[Totem]')} Running diagnostics...\n`);

  const results: DiagnosticResult[] = [
    checkConfig(cwd),
    checkCompiledRules(cwd),
    checkGitHooks(cwd),
    checkEmbeddingConfig(cwd),
    checkIndex(cwd),
    await checkSecretLeaks(cwd),
    checkSecretsFileTracked(cwd),
    await checkUpgradeCandidates(cwd),
  ];

  for (const result of results) {
    console.error(formatResult(result));
  }

  const counts = {
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
  };

  const parts: string[] = [];
  parts.push(pc.green(`${counts.pass} passed`));
  if (counts.warn > 0) parts.push(pc.yellow(`${counts.warn} warnings`));
  else parts.push(`${counts.warn} warnings`);
  if (counts.fail > 0) parts.push(pc.red(`${counts.fail} failures`));
  else parts.push(`${counts.fail} failures`);

  console.error(`\n${pc.cyan('[Totem]')} ${parts.join(', ')}`);

  // After diagnostics, if --pr is passed, run self-healing
  if (options.pr) {
    await runSelfHealing(cwd);
  }

  return results;
}
