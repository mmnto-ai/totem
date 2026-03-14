/**
 * Config drift tests — ensures our dev environment stays in sync
 * with the consumer templates shipped by `totem init` and `totem hooks`.
 *
 * If these fail, it means our dogfood config has diverged from what
 * consumers get out of the box. Fix the drift before shipping.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AI_PROMPT_BLOCK, buildNpxCommand, REFLEX_VERSION } from '../commands/init.js';
import {
  buildPreCommitHook,
  buildPrePushHook,
  TOTEM_PRECOMMIT_MARKER,
  TOTEM_PREPUSH_MARKER,
} from './install-hooks.js';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readRoot(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf-8');
}

// ─── Git hook drift ──────────────────────────────────

describe('dev hooks match consumer templates', () => {
  const devPreCommit = readRoot('tools/pre-commit');
  const devPrePush = readRoot('tools/pre-push');
  const devPostMerge = readRoot('tools/post-merge');

  it('dev pre-commit contains consumer marker', () => {
    expect(devPreCommit).toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('dev pre-push contains consumer marker', () => {
    expect(devPrePush).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('dev pre-commit blocks the same branches as consumer template', () => {
    const consumerHook = buildPreCommitHook();
    // Both must block main and master
    expect(devPreCommit).toContain('"main"');
    expect(devPreCommit).toContain('"master"');
    expect(consumerHook).toContain('"main"');
    expect(consumerHook).toContain('"master"');
  });

  it('dev pre-push runs deterministic shield like consumer template', () => {
    const consumerHook = buildPrePushHook('pnpm exec totem shield --deterministic');
    expect(devPrePush).toContain('shield --deterministic');
    expect(consumerHook).toContain('shield --deterministic');
  });

  it('dev post-merge runs totem sync like consumer template', () => {
    expect(devPostMerge).toContain('totem sync');
    expect(devPostMerge).toContain('[totem]');
  });

  it('all dev hooks start with a shebang', () => {
    expect(devPreCommit).toMatch(/^#!\/bin\/sh\r?\n/);
    expect(devPrePush).toMatch(/^#!\/bin\/sh\r?\n/);
    expect(devPostMerge).toMatch(/^#!\/bin\/sh\r?\n/);
  });
});

// ─── Agent config drift ─────────────────────────────

describe('agent instruction files match consumer AI_PROMPT_BLOCK', () => {
  const claudeMd = readRoot('CLAUDE.md');
  const geminiMd = readRoot('GEMINI.md');
  const junieGuidelines = readRoot('.junie/guidelines.md');

  it('CLAUDE.md contains the search_knowledge instruction', () => {
    expect(claudeMd).toContain('search_knowledge');
  });

  it('GEMINI.md contains the search_knowledge instruction', () => {
    expect(geminiMd).toContain('search_knowledge');
  });

  it('Junie guidelines.md contains the search_knowledge instruction', () => {
    expect(junieGuidelines).toContain('search_knowledge');
  });

  it('AI_PROMPT_BLOCK contains the search_knowledge reflex', () => {
    expect(AI_PROMPT_BLOCK).toContain('search_knowledge');
  });

  it('AI_PROMPT_BLOCK has a valid reflex version', () => {
    expect(REFLEX_VERSION).toBeGreaterThanOrEqual(1); // totem-ignore — version floor check, not a set count
    expect(AI_PROMPT_BLOCK).toContain(`totem:reflexes:version:${REFLEX_VERSION}`);
  });
});

// ─── Instruction file length limits (FR-C01) ─────────

describe('agent instruction files stay under 50 lines (FMEA-001 / FR-C01)', () => {
  const MAX_LINES = 50;

  const files = [
    { name: 'CLAUDE.md', content: readRoot('CLAUDE.md') },
    { name: 'GEMINI.md', content: readRoot('GEMINI.md') },
    { name: '.junie/guidelines.md', content: readRoot('.junie/guidelines.md') },
  ];

  for (const { name, content } of files) {
    it(`${name} is under ${MAX_LINES} lines`, () => {
      const lineCount = content.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(MAX_LINES);
    });
  }
});

// ─── Cross-agent consistency ─────────────────────────

describe('all agent instruction files share the same project rules', () => {
  const claudeMd = readRoot('CLAUDE.md');
  const geminiMd = readRoot('GEMINI.md');
  const junieGuidelines = readRoot('.junie/guidelines.md');

  const SHARED_RULES = [
    // Git
    '`main` is protected',
    'Never amend commits on feature branches',
    'Use `Closes #NNN` in PR descriptions',
    // Environment
    'pnpm (never npm or yarn)',
    'Windows 11 + Git Bash',
    'TypeScript strict mode',
    'NEVER put secrets, tokens, or API keys in config files',
    // Code Style
    '`kebab-case.ts`',
    '`err` (never `error`)',
    'No empty catch blocks',
    'Extract magic numbers into named constants',
    'Zod for runtime validation at system boundaries',
    '`pnpm run format`',
    // Publishing
    'Changesets + npm OIDC trusted publishing',
    'RELEASE_TOKEN',
    '`pnpm run version`',
    // Contributor Principles
    'Consumer-first',
    'GCA decline reflex',
  ];

  for (const rule of SHARED_RULES) {
    it(`all agent files contain: "${rule}"`, () => {
      expect(claudeMd).toContain(rule);
      expect(geminiMd).toContain(rule);
      expect(junieGuidelines).toContain(rule);
    });
  }
});

// ─── MCP server drift ────────────────────────────────

describe('consumer MCP scaffolding matches published package', () => {
  it('buildNpxCommand references the correct MCP package name', () => {
    const unix = buildNpxCommand(false);
    const win = buildNpxCommand(true);
    expect(unix.args).toContain('@mmnto/mcp');
    expect(win.args).toContain('@mmnto/mcp');
  });

  it('MCP package.json main entrypoint exists', () => {
    const mcpPkg = JSON.parse(readRoot('packages/mcp/package.json'));
    const mainPath = path.join(ROOT, 'packages', 'mcp', mcpPkg.main);
    expect(fs.existsSync(mainPath)).toBe(true);
  });

  it('dev .mcp.json points to the correct local MCP entrypoint', () => {
    const mcpPath = path.join(ROOT, '.mcp.json');
    if (!fs.existsSync(mcpPath)) return; // gitignored — skip in CI
    const mcpJson = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
    const totemServer = mcpJson.mcpServers?.['totem-dev'];
    expect(totemServer).toBeDefined();
    expect(totemServer.args).toContain('./packages/mcp/dist/index.js');
  });

  it('consumer MCP server entry uses npx (not local path)', () => {
    const unix = buildNpxCommand(false);
    expect(unix.command).toBe('npx');
    expect(unix.args).not.toContain('./packages/mcp/dist/index.js');
  });

  it('Windows consumer MCP entry uses cmd /c npx wrapper', () => {
    const win = buildNpxCommand(true);
    expect(win.command).toBe('cmd');
    expect(win.args[0]).toBe('/c');
    expect(win.args).toContain('npx');
  });
});

// ─── Consumer init scaffolding accuracy ──────────────

describe('totem init scaffolds correct paths for each agent', () => {
  // These are the reflexFile paths that totem init writes into.
  // If they don't match what the agent actually reads, the reflexes are dead.
  it('Claude reflexFile targets CLAUDE.md (root)', () => {
    // init.ts defines reflexFile: 'CLAUDE.md' for Claude Code
    // Verify our actual file exists at that path
    expect(fs.existsSync(path.join(ROOT, 'CLAUDE.md'))).toBe(true);
  });

  it('Gemini reflexFile should target GEMINI.md (root), not .gemini/gemini.md', () => {
    // Gemini CLI reads uppercase GEMINI.md from project root by default.
    // .gemini/gemini.md (lowercase) is NOT read by either GCA or Gemini CLI.
    expect(fs.existsSync(path.join(ROOT, 'GEMINI.md'))).toBe(true);
    // The old dead path should not exist
    expect(fs.existsSync(path.join(ROOT, '.gemini', 'gemini.md'))).toBe(false);
  });
});

// ─── Secrets hygiene ─────────────────────────────────

describe('no secrets in tracked config files', () => {
  const CONFIG_FILES = [
    'CLAUDE.md',
    'GEMINI.md',
    '.junie/guidelines.md',
    '.gemini/config.yaml',
    '.gemini/styleguide.md',
  ];

  const SECRET_PATTERNS = [
    /ghp_[a-zA-Z0-9]{36}/, // GitHub PAT (classic)
    /github_pat_[a-zA-Z0-9_]+/, // GitHub PAT (fine-grained)
    /sk-[a-zA-Z0-9]{20,}/, // OpenAI API key
    /AIza[a-zA-Z0-9_-]{35}/, // Google API key
    /sk-ant-[a-zA-Z0-9_-]{20,}/, // Anthropic API key
  ];

  for (const file of CONFIG_FILES) {
    it(`${file} contains no hardcoded secrets`, () => {
      const filePath = path.join(ROOT, file);
      if (!fs.existsSync(filePath)) return; // Skip if file doesn't exist yet
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const pattern of SECRET_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});
