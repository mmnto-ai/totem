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

export function checkLinkedIndexes(cwd: string): DiagnosticResult {
  const configResult = readConfigFile(cwd);
  if (!configResult) {
    return {
      name: 'Linked Indexes',
      status: 'skip',
      message: 'No config (skipped)',
    };
  }

  const [, content] = configResult;

  if (!/linkedIndexes:\s*\[/.test(content)) {
    return {
      name: 'Linked Indexes',
      status: 'skip',
      message: '0 configured',
    };
  }

  if (!hasEmbeddingProvider(content)) {
    return {
      name: 'Linked Indexes',
      status: 'skip',
      message: 'Lite tier (no embedding)',
    };
  }

  // Extract linked paths from the config array
  const arrayMatch = /linkedIndexes:\s*\[([\s\S]*?)\]/.exec(content);
  const linkedPaths: string[] = [];
  if (arrayMatch) {
    const arrayContent = arrayMatch[1];
    let m: RegExpExecArray | null;
    const strRe = /['"]([^'"]+)['"]/g;
    while ((m = strRe.exec(arrayContent)) !== null) {
      linkedPaths.push(m[1]);
    }
  }

  if (linkedPaths.length === 0) {
    return {
      name: 'Linked Indexes',
      status: 'skip',
      message: '0 configured',
    };
  }

  const issues: string[] = [];
  const seenNames = new Set<string>();
  let reachable = 0;

  for (const linkedPath of linkedPaths) {
    const resolvedPath = path.resolve(cwd, linkedPath);
    const linkName = path.basename(resolvedPath).replace(/^\./, '');
    let entryOk = true;

    if (seenNames.has(linkName)) {
      issues.push(`name collision on '${linkName}'`);
      entryOk = false;
    } else {
      seenNames.add(linkName);
    }

    if (!fs.existsSync(resolvedPath)) {
      issues.push(`'${linkName}' path does not exist (${resolvedPath})`);
      continue;
    }

    const lanceDbPath = path.join(resolvedPath, '.lancedb');
    if (!fs.existsSync(lanceDbPath)) {
      issues.push(`'${linkName}' has no .lancedb index (run totem sync in ${resolvedPath})`);
      entryOk = false;
    }

    const linkedConfig = readConfigFile(resolvedPath);
    if (!linkedConfig) {
      issues.push(`'${linkName}' has no totem config`);
      entryOk = false;
    } else {
      const [, linkedContent] = linkedConfig;
      if (!hasEmbeddingProvider(linkedContent)) {
        issues.push(`'${linkName}' has no embedding provider (dimension mismatch risk)`);
        entryOk = false;
      }
    }

    if (entryOk) {
      reachable++;
    }
  }

  const n = linkedPaths.length;

  if (issues.length === 0) {
    return {
      name: 'Linked Indexes',
      status: 'pass',
      message: `${n} configured, ${reachable} reachable`,
    };
  }

  return {
    name: 'Linked Indexes',
    status: 'warn',
    message: `${n} configured, ${reachable} reachable, ${issues.length} issue(s)`,
    remediation: issues.join('; '),
  };
}

/**
 * Strategy-root resolver diagnostic (mmnto-ai/totem#1710).
 *
 * Runs `resolveStrategyRoot` and reports which precedence layer matched.
 * Advisory only: `warn` (not `fail`) on unresolved so a freshly-cloned
 * project without a strategy repo doesn't fail the doctor pass.
 *
 * Affected consumer surfaces if unresolved: MCP `describe_project`
 * rich-state pointer, `totem proposal new` / `totem adr new`, federated
 * search via the auto-injected strategy linkedIndex, the bench scripts
 * under `scripts/`.
 *
 * Async + dynamic import to keep `@mmnto/totem` off the CLI cold-start
 * graph (matches `checkSecretLeaks` and the rest of the diagnostics that
 * need core).
 */
export async function checkStrategyRoot(
  cwd: string,
  config?: { strategyRoot?: string },
): Promise<DiagnosticResult> {
  const { resolveStrategyRoot } = await import('@mmnto/totem');
  const status = resolveStrategyRoot(cwd, { config });
  if (status.resolved) {
    const rel = path.relative(cwd, status.path) || '.';
    return {
      name: 'Strategy Root',
      status: 'pass',
      message: `${status.source} → ${rel}`,
    };
  }

  return {
    name: 'Strategy Root',
    status: 'warn',
    message: 'unresolved',
    remediation: `${status.reason} Affected: describe_project pointer, proposal/adr scaffolding, federated strategy search, bench scripts.`,
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

      // Skip manual regex rules. Manual rules take the Pipeline 1 path in
      // `compileLesson`, which never receives `telemetryPrefix` — so a
      // `--upgrade` run on a manual rule would just recompile the same
      // hand-written pattern and produce a permanent false positive.
      //
      // Post-mmnto/totem#1265: prefer the explicit `manual: true` flag set in
      // `buildManualRule`. Pre-mmnto/totem#1265 rules don't have the flag, so fall back to
      // the legacy `lessonHeading === message` heuristic — which only worked
      // because pre-#1265 manual rules had no way to express a custom message
      // and the compiler hardcoded `message: lesson.heading`. After mmnto/totem#1265 added
      // Pipeline 1 Message field support, manual rules can have rich messages
      // distinct from their headings, breaking the heuristic for new rules.
      if (rule.manual === true || rule.lessonHeading === rule.message) continue;

      const metric = metricsFile.rules[rule.lessonHash];
      if (!metric || !metric.contextCounts) continue;

      // Exclude `unknown` from both numerator and denominator — it represents
      // historical / unclassified telemetry (pre-context-aware hits, or seeding
      // via `triggerCount - 1`) and is not evidence of non-code leakage.
      // The `?? 0` defaults are defensive: the Zod schema at
      // packages/core/src/rule-metrics.ts declares every contextCounts field
      // as a non-negative integer, but a hand-edited rule-metrics.json could
      // bypass that and produce NaN in the arithmetic below.
      const cc = metric.contextCounts;
      const code = cc.code ?? 0;
      const strings = cc.string ?? 0;
      const comments = cc.comment ?? 0;
      const regexes = cc.regex ?? 0;
      const classifiedTotal = code + strings + comments + regexes;
      if (classifiedTotal < MIN_CONTEXT_EVENTS) continue;

      const nonCodeRatio = (strings + comments + regexes) / classifiedTotal;
      if (nonCodeRatio > NON_CODE_THRESHOLD) {
        candidates.push({
          lessonHash: rule.lessonHash,
          heading: rule.lessonHeading ?? rule.lessonHash,
          engine: 'regex',
          total: classifiedTotal,
          codeCount: code,
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
 * for being upgraded to structural ast-grep patterns via `totem lesson compile --upgrade`.
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
    remediation: `Run \`totem lesson compile --upgrade ${firstHash}\` to re-compile through Claude Sonnet with telemetry guidance.`,
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
  /**
   * Always `'regex'` — `findUpgradeCandidates` filters to regex rules only
   * because only they carry trustworthy non-code telemetry. Narrowed from
   * the broader engine union so the type matches the implementation.
   */
  engine: 'regex';
  total: number;
  codeCount: number;
  nonCodeRatio: number;
}

// ─── Stale-rule detection (mmnto-ai/totem#1483) ────────

/**
 * Pure helper signature: a staleness candidate as returned by
 * `findStaleRules`. The `severity` distinction lets the formatter label
 * security rules visually distinct from standard rules without the caller
 * needing to re-derive the category from the compiled rule.
 */
export interface StaleRuleCandidate {
  lessonHash: string;
  heading: string;
  evaluationCount: number;
  severity: 'standard' | 'security';
  /** The recommended next step surfaced in the advisory text. */
  recommendation: string;
  /** Compile-metadata flags relevant to the advisory. */
  flags: {
    unverified?: boolean;
    immutable?: boolean;
    category?: string;
  };
}

/**
 * Pure helper: scan compiled rules + metrics and return structured
 * stale-rule candidates. A rule is stale when it has accrued at least
 * `staleRuleWindow` evaluations over its lifetime and has never landed a
 * match in code context (`contextCounts.code === 0`).
 *
 * Security rules (`category === 'security'` OR `immutable === true`) get
 * flagged with the `security` severity so the formatter can mark them
 * with a higher-severity label. Per the design doc, doctor never
 * recommends archival for security rules.
 */
export async function findStaleRules(
  cwd: string,
  totemDir = '.totem',
  thresholds: { staleRuleWindow: number } = { staleRuleWindow: 10 },
): Promise<StaleRuleCandidate[] | null> {
  const totemDirAbs = path.join(cwd, totemDir);
  const rulesPath = path.join(totemDirAbs, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) return null;

  try {
    const { loadCompiledRulesFile, loadRuleMetrics } = await import('@mmnto/totem');
    const rulesFile = loadCompiledRulesFile(rulesPath);
    const metricsFile = loadRuleMetrics(totemDirAbs);

    const candidates: StaleRuleCandidate[] = [];
    for (const rule of rulesFile.rules) {
      // Skip archived rules — the advisory addresses active rules only.
      if (rule.status === 'archived') continue;

      const metric = metricsFile.rules[rule.lessonHash];
      const evaluationCount = metric?.evaluationCount ?? 0;

      // v1 staleness check: cumulative lifetime evaluations against a single
      // threshold. A rule that fired once years ago then went silent stays
      // exempt forever. mmnto-ai/totem#1550 tracks swapping to rolling-window
      // semantics via a `RuleMetric.runHistory` ring buffer; the config key
      // stays, only the math upgrades.
      if (evaluationCount < thresholds.staleRuleWindow) continue;

      const codeMatches = metric?.contextCounts?.code ?? 0;
      if (codeMatches > 0) continue;

      const isSecurity = rule.category === 'security' || rule.immutable === true;
      const recommendation = isSecurity
        ? `Review and refine the rule via totem compile --upgrade ${rule.lessonHash}. Do not archive security rules.`
        : `Run totem compile --upgrade ${rule.lessonHash} to refine the pattern, or archive the rule by setting status: 'archived'.`;

      candidates.push({
        lessonHash: rule.lessonHash,
        heading: rule.lessonHeading ?? rule.lessonHash,
        evaluationCount,
        severity: isSecurity ? 'security' : 'standard',
        recommendation,
        flags: {
          unverified: rule.unverified,
          immutable: rule.immutable,
          category: rule.category,
        },
      });
    }
    // Surface security rules first, then by evaluationCount descending so the
    // stalest rules lead the list.
    return candidates.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'security' ? -1 : 1;
      return b.evaluationCount - a.evaluationCount;
    });
  } catch (err) {
    // Best-effort fallback — degrade to "no data" so a corrupt rules or
    // metrics file does not crash the doctor pipeline. Matches the
    // `findUpgradeCandidates` sibling path in this file. The caller wraps
    // the root cause into the telemetry fallback advisory rather than
    // dropping the signal.
    if (err instanceof Error && err.message.length === 0) {
      throw err;
    }
    return null;
  }
}

/**
 * Stale-rule advisory diagnostic. Returns a single DiagnosticResult
 * regardless of how many rules were flagged; the details list is
 * serialized into the `message` + `remediation` fields. Per the design
 * doc, this is advisory-only — no auto-archive, no side effects on the
 * rules file.
 */
export async function checkStaleRules(
  cwd: string,
  totemDir = '.totem',
  thresholds?: { staleRuleWindow: number },
): Promise<DiagnosticResult> {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    return {
      name: 'Stale Rules',
      status: 'skip',
      message: 'compiled-rules.json missing',
    };
  }

  const candidates = await findStaleRules(cwd, totemDir, thresholds);
  if (candidates === null) {
    return {
      name: 'Stale Rules',
      status: 'skip',
      message: 'Could not analyze rules',
    };
  }

  if (candidates.length === 0) {
    return {
      name: 'Stale Rules',
      status: 'pass',
      message:
        'All active rules have exercised code-context hits or are still accruing evaluations',
    };
  }

  const securityCount = candidates.filter((c) => c.severity === 'security').length;
  const standardCount = candidates.length - securityCount;

  // Build a compact summary line for message. Detailed per-rule guidance
  // rides in remediation.
  const summaryParts: string[] = [];
  if (securityCount > 0) summaryParts.push(`${securityCount} security`);
  if (standardCount > 0) summaryParts.push(`${standardCount} standard`);
  const summary = summaryParts.join(', ');

  const top = candidates[0]!;
  return {
    name: 'Stale Rules',
    status: 'warn',
    message: `${candidates.length} rule(s) flagged stale (${summary}); leader: ${top.lessonHash.slice(0, 8)} "${top.heading}" after ${top.evaluationCount} runs with 0 code-context hits`,
    remediation: top.recommendation,
  };
}

// ─── Grandfathered-rule advisory (mmnto-ai/totem#1603) ─

/**
 * ISO timestamp for the 1.13.0 ship date. Rules whose vintage timestamp
 * precedes this never saw the ADR-088 Phase 1 substrate fields
 * (`badExample`, `goodExample`, `unverified`) during their compile. Used
 * by `findLegacyGrandfatheredRules` to categorize the pre-zero-trust
 * cohort the 2026-04-20 audit measured at 357 of 378 active rules.
 */
export const V_1_13_0_SHIP_DATE_ISO = '2026-04-07T00:00:00.000Z';

export type GrandfatheredReasonCode = 'vintage-pre-1.13.0' | 'no-badExample' | 'no-goodExample';

export interface GrandfatheredRuleCandidate {
  lessonHash: string;
  heading: string;
  /** Non-empty: rules with zero applicable reasons are not returned. */
  reasons: GrandfatheredReasonCode[];
  /** `createdAt` when present, `compiledAt` otherwise; used for the vintage check. */
  vintage: string;
}

/**
 * Pure helper: scan compiled rules and return the grandfathered
 * pre-zero-trust cohort categorized by reason. A rule is a candidate
 * when it is active (`status !== 'archived'`) and lacks the `unverified`
 * flag from ADR-089 part 1 (mmnto-ai/totem#1581). Each candidate gets
 * every reason that applies:
 *
 *   - `vintage-pre-1.13.0`: vintage timestamp precedes the 1.13.0 ship date.
 *   - `no-badExample`: empty or absent `badExample` field.
 *   - `no-goodExample`: empty or absent `goodExample` field.
 *
 * Rules with at least one reason are returned; rules that satisfy all
 * three substrate checks are omitted.
 *
 * Returns `null` when `compiled-rules.json` is missing or unreadable,
 * matching the fallback convention used by `findStaleRules` so the
 * caller can render a `skip` diagnostic rather than fail the pipeline.
 */
export async function findLegacyGrandfatheredRules(
  cwd: string,
  totemDir = '.totem',
): Promise<GrandfatheredRuleCandidate[] | null> {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) return null;

  try {
    const { loadCompiledRulesFile } = await import('@mmnto/totem');
    const rulesFile = loadCompiledRulesFile(rulesPath);

    const candidates: GrandfatheredRuleCandidate[] = [];
    for (const rule of rulesFile.rules) {
      if (rule.status === 'archived') continue;
      if (rule.unverified === true) continue;

      const vintage = rule.createdAt ?? rule.compiledAt;
      const reasons: GrandfatheredReasonCode[] = [];
      if (vintage < V_1_13_0_SHIP_DATE_ISO) reasons.push('vintage-pre-1.13.0');
      if (!rule.badExample || rule.badExample.trim().length === 0) {
        reasons.push('no-badExample');
      }
      if (!rule.goodExample || rule.goodExample.trim().length === 0) {
        reasons.push('no-goodExample');
      }

      if (reasons.length === 0) continue;

      candidates.push({
        lessonHash: rule.lessonHash,
        heading: rule.lessonHeading,
        reasons,
        vintage,
      });
    }

    // Sort by reason count desc (worst-off first), then vintage asc
    // (oldest first) so the leader line surfaces the most affected rule.
    return candidates.sort((a, b) => {
      if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
      return a.vintage.localeCompare(b.vintage);
    });
  } catch (err) {
    // Matches `findStaleRules` fallback: corrupt or unreadable rules file
    // degrades to "no data" so one bad read cannot crash the diagnostic
    // pipeline. Defective Error objects (empty message) still propagate.
    if (err instanceof Error && err.message.length === 0) {
      throw err;
    }
    return null;
  }
}

/**
 * Grandfathered-rule advisory diagnostic. Summarizes the pre-zero-trust
 * cohort by reason code. Advisory-only (`warn`): ADR-091 Stage 4
 * Codebase Verifier (1.16.0, mmnto-ai/totem#1504) is the empirical
 * audit path; this check gives users a triage-able surface until that
 * ships.
 */
export async function checkGrandfatheredRules(
  cwd: string,
  totemDir = '.totem',
): Promise<DiagnosticResult> {
  const rulesPath = path.join(cwd, totemDir, 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    return {
      name: 'Grandfathered Rules',
      status: 'skip',
      message: 'compiled-rules.json missing',
    };
  }

  const candidates = await findLegacyGrandfatheredRules(cwd, totemDir);
  if (candidates === null) {
    return {
      name: 'Grandfathered Rules',
      status: 'skip',
      message: 'Could not analyze rules',
    };
  }

  if (candidates.length === 0) {
    return {
      name: 'Grandfathered Rules',
      status: 'pass',
      message: 'All active rules carry the ADR-089 zero-trust substrate',
    };
  }

  const reasonCounts: Record<GrandfatheredReasonCode, number> = {
    'vintage-pre-1.13.0': 0,
    'no-badExample': 0,
    'no-goodExample': 0,
  };
  for (const candidate of candidates) {
    for (const reason of candidate.reasons) {
      reasonCounts[reason]++;
    }
  }

  const summaryParts: string[] = [];
  if (reasonCounts['vintage-pre-1.13.0'] > 0) {
    summaryParts.push(`${reasonCounts['vintage-pre-1.13.0']} vintage-pre-1.13.0`);
  }
  if (reasonCounts['no-badExample'] > 0) {
    summaryParts.push(`${reasonCounts['no-badExample']} no-badExample`);
  }
  if (reasonCounts['no-goodExample'] > 0) {
    summaryParts.push(`${reasonCounts['no-goodExample']} no-goodExample`);
  }

  return {
    name: 'Grandfathered Rules',
    status: 'warn',
    message: `${candidates.length} grandfathered rule(s): ${summaryParts.join(', ')}`,
    remediation:
      'Pre-zero-trust cohort. ADR-091 Stage 4 Codebase Verifier (1.16.0) will empirically validate these against real code; see mmnto-ai/totem#1504.',
  };
}

// ─── Types ──────────────────────────────────────────────

export interface DoctorOptions {
  pr?: boolean;
}

// ─── Self-healing flow ──────────────────────────────────

// totem-context: spawnSync, fs, path, and pc are static imports at lines 1-5 of this file. The review pipeline only sees diff hunks, so new references to these symbols far from the import block should not be flagged as undefined.
export async function runSelfHealing(cwd: string): Promise<void> {
  // Note: we do NOT pre-flight `gh` here. The diagnostic + downgrade + upgrade
  // work is still valuable on a machine without gh installed — the user just
  // can't auto-open a PR. The try/catch around `gh pr create` below catches the
  // missing-dependency case and tells the user how to push + open the PR
  // manually, which is better UX than aborting all the work up front. (The
  // original GCA suggestion to add requireGhCli() matches commands like
  // `triage-pr` whose sole purpose is PR interaction; doctor's purpose is
  // diagnosis, so gh is a nice-to-have, not a hard requirement.)

  // Load config to get totemDir
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  // compileCommand rewrites this file on every --upgrade call, so the
  // upgrade phase needs to stage it alongside compiled-rules.json (or revert
  // it if no actual changes land) to keep the working tree clean.
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

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

    // fs is statically imported at the top of this file (line 2); no need to
    // re-import dynamically here (mmnto/totem#1234 CR cleanup).
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

  // ─── Upgrade phase: re-compile flagged rules through Sonnet (mmnto/totem#1131, #1235) ─
  const upgraded: UpgradeCandidate[] = [];
  // Set to true whenever we invoke compileCommand({ upgradeBatch }) — even for
  // noop outcomes — because the call rewrites compile-manifest.json. Drives
  // the manifest-revert / manifest-stage decision below.
  let upgradePhaseTouchedManifest = false;

  if (!gitDirty) {
    console.error(`\n${pc.cyan('[Auto-Healing]')} Checking for ast-grep upgrade candidates...`);
    const candidates = await findUpgradeCandidates(cwd, config.totemDir);

    if (candidates === null || candidates.length === 0) {
      console.error(pc.dim('  No rules flagged for upgrade.'));
    } else {
      console.error(`  Found ${candidates.length} upgrade candidate(s). Re-compiling...`);

      // mmnto/totem#1235: build telemetry prefixes for all candidates in one
      // metrics load, then invoke compileCommand once with upgradeBatch so the
      // config/lessons/rules load cycle runs exactly once regardless of N.
      // mmnto/totem#1232: pass cwd explicitly so the compile runs against the
      // directory runSelfHealing was called with, not process.cwd().
      const { buildTelemetryPrefix, compileCommand } = await import('./compile.js');
      const { loadRuleMetrics } = await import('@mmnto/totem');
      // loadRuleMetrics catches ENOENT and parse errors internally; the try/catch
      // here is a defensive belt-and-suspenders guard for future changes.
      let metricsFile: ReturnType<typeof loadRuleMetrics>;
      try {
        metricsFile = loadRuleMetrics(path.join(cwd, config.totemDir));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Doctor] Could not load rule metrics, proceeding without telemetry - ${msg}`);
        metricsFile = { version: 1, rules: {} };
      }

      const upgradeBatch = candidates.map((cand) => {
        const metric = metricsFile.rules[cand.lessonHash];
        const telemetryPrefix = metric?.contextCounts
          ? buildTelemetryPrefix(metric.contextCounts)
          : undefined;
        return { hash: cand.lessonHash, telemetryPrefix };
      });

      // Build a lookup so we can map outcomes back to UpgradeCandidates for
      // the console log and the upgraded[] list used in the PR body.
      const candByHash = new Map(candidates.map((c) => [c.lessonHash, c]));

      try {
        const outcomes = await compileCommand({ upgradeBatch, cwd });
        upgradePhaseTouchedManifest = true;
        // Only count actual replacements. `skipped` / `noop` / `failed` all
        // return normally but leave no real upgrade to report (mmnto/totem#1234
        // CR finding — avoids lying in the auto-heal PR body).
        if (Array.isArray(outcomes)) {
          for (const outcome of outcomes) {
            const cand = candByHash.get(outcome.hash);
            if (!cand) continue;
            if (outcome.status === 'replaced') {
              upgraded.push(cand);
              console.error(
                `  ${pc.green('↑')} ${cand.heading} (${(cand.nonCodeRatio * 100).toFixed(0)}% non-code)`,
              );
            } else if (outcome.status === 'skipped') {
              console.error(
                pc.dim(`  - ${cand.heading} — compiler marked non-compilable; no upgrade`),
              );
            } else if (outcome.status === 'failed') {
              console.error(pc.red(`  ✗ ${cand.heading} — upgrade failed`));
            } else {
              // 'noop' and any other status
              console.error(pc.dim(`  - ${cand.heading} — no change`));
            }
          }
        }
      } catch (err) {
        // compileCommand can throw on config errors, network hard failures,
        // etc. Even a thrown error means the manifest may have been touched
        // before the throw, so keep the flag set above.
        upgradePhaseTouchedManifest = true;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(pc.yellow(`  Upgrade batch failed: ${msg}`));
      }

      if (upgraded.length > 0) {
        console.error(`\n  ${pc.green(`Upgraded ${upgraded.length} rule(s) via telemetry.`)}`);
      }
    }
  }

  if (downgraded.length === 0 && archivedCount === 0 && upgraded.length === 0) {
    // If the upgrade phase called compileCommand at all (even for candidates
    // that ended in noop/skipped/failed), compile-manifest.json was rewritten.
    // Revert it so the working tree on the original branch stays clean
    // (mmnto/totem#1234 CR finding). spawnSync is imported at the top of this
    // file; stdio: 'ignore' + no status check makes the call a silent no-op
    // if the file is already clean or the checkout fails for any reason.
    if (upgradePhaseTouchedManifest) {
      spawnSync('git', ['checkout', '--', manifestPath], { cwd, stdio: 'ignore' });
    }
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
    // Stage compile-manifest.json alongside compiled-rules.json when the
    // upgrade phase ran — otherwise the temp branch will diverge from the
    // working tree and the checkout back to originalBranch can fail
    // (mmnto/totem#1234 CR finding).
    if (upgradePhaseTouchedManifest && fs.existsSync(manifestPath)) {
      run('git', ['add', rulesPath, manifestPath]);
    } else {
      run('git', ['add', rulesPath]);
    }

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

  // Resolve doctor thresholds + strategyRoot from config when available. The
  // default window (10) lines up with the schema default so missing config
  // still gives the documented behavior. mmnto-ai/totem#1710 R2: capture
  // `strategyRoot` here too so `checkStrategyRoot` honors the precedence-2
  // config layer. R3 (CR): only use the config's `strategyRoot` when the
  // resolved path is the repo-local file. A global `~/.totem/` profile is
  // a personal default for tier/embedder choice and must NOT leak its
  // strategyRoot across every repo on disk.
  let doctorThresholds: { staleRuleWindow: number } | undefined;
  let loadedConfig: { strategyRoot?: string } | undefined;
  try {
    const { loadConfig, resolveConfigPath, isGlobalConfigPath } = await import('../utils.js');
    const configPath = resolveConfigPath(cwd);
    const config = await loadConfig(configPath);
    if (!isGlobalConfigPath(configPath)) {
      loadedConfig = config;
    }
    if (config.doctor) {
      doctorThresholds = { staleRuleWindow: config.doctor.staleRuleWindow };
    }
  } catch (err) {
    // Running `totem doctor` against a repo with no config is a valid path
    // (every other check handles its own missing-file case). A corrupt or
    // unreadable config lets the stale-rule check fall back to schema
    // defaults rather than blocking the rest of the diagnostic pipeline.
    // Surface the error only on a defective error object so sentinels
    // still propagate.
    if (err instanceof Error && err.message.length === 0) {
      throw err;
    }
  }

  const results: DiagnosticResult[] = [
    checkConfig(cwd),
    checkCompiledRules(cwd),
    checkGitHooks(cwd),
    checkEmbeddingConfig(cwd),
    checkIndex(cwd),
    checkLinkedIndexes(cwd),
    await checkStrategyRoot(cwd, loadedConfig),
    await checkSecretLeaks(cwd),
    checkSecretsFileTracked(cwd),
    await checkUpgradeCandidates(cwd),
    await checkStaleRules(cwd, '.totem', doctorThresholds),
    await checkGrandfatheredRules(cwd),
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
