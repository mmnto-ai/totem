import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import pc from 'picocolors';

import { compileCustomSecrets, loadCustomSecrets } from '@mmnto/totem';

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

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
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

export function checkSecretLeaks(cwd: string, totemDir = '.totem'): DiagnosticResult {
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

  // Load user-defined custom secrets
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
    const result = execSync(`git ls-files --recurse-submodules "${secretsPath}"`, {
      cwd,
      encoding: 'utf-8',
    }).trim();
    if (result.length > 0) {
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

// ─── Main command ───────────────────────────────────────

export async function doctorCommand(): Promise<DiagnosticResult[]> {
  const cwd = process.cwd();

  console.error(`${pc.cyan('[Totem]')} Running diagnostics...\n`);

  const results: DiagnosticResult[] = [
    checkConfig(cwd),
    checkCompiledRules(cwd),
    checkGitHooks(cwd),
    checkEmbeddingConfig(cwd),
    checkIndex(cwd),
    checkSecretLeaks(cwd),
    checkSecretsFileTracked(cwd),
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

  return results;
}
