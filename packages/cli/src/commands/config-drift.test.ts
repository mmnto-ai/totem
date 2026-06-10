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

  it('dev pre-push runs totem lint and consumer template runs lint stateless', () => {
    const consumerHook = buildPrePushHook('pnpm dlx @mmnto/cli');
    expect(devPrePush).toContain('totem lint');
    // Consumer hook runs lint directly via $TOTEM_CMD — no flag files
    expect(consumerHook).toContain('$TOTEM_CMD lint');
    expect(consumerHook).toContain('verify-manifest');
    expect(consumerHook).not.toContain('.lint-passed');
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
  // Post ADR-038 migration: AGENTS.md is the canonical for Claude Code + Gemini CLI
  // (read via CLAUDE.md + GEMINI.md redirect files). .junie/guidelines.md remains
  // canonical for Junie sessions until that migration follows.
  const agentsMd = readRoot('AGENTS.md');
  const junieGuidelines = readRoot('.junie/guidelines.md');

  it('AGENTS.md contains the search_knowledge instruction', () => {
    expect(agentsMd).toContain('search_knowledge');
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

describe('agent instruction files stay concise (FMEA-001 / FR-C01)', () => {
  // Canonical files carry full agent context (cross-vendor for AGENTS.md,
  // self-canonical for .junie/guidelines.md). Budget bumped to 6000/40 in
  // ADR-038 migration to accommodate AGENTS.md absorbing the cross-vendor
  // content that CLAUDE.md + GEMINI.md previously held separately.
  const CANONICAL_MAX_CHARS = 6000;
  const CANONICAL_MAX_DIRECTIVES = 40;

  // Redirect files exist only to point Claude Code / Gemini CLI at AGENTS.md.
  // They should stay tiny; this ceiling enforces redirect-shape post-migration.
  const REDIRECT_MAX_CHARS = 1000;

  const canonical = [
    { name: 'AGENTS.md', content: readRoot('AGENTS.md') },
    { name: '.junie/guidelines.md', content: readRoot('.junie/guidelines.md') },
  ];

  const redirects = [
    { name: 'CLAUDE.md', content: readRoot('CLAUDE.md') },
    { name: 'GEMINI.md', content: readRoot('GEMINI.md') },
  ];

  for (const { name, content } of canonical) {
    it(`${name} is under ${CANONICAL_MAX_CHARS} characters`, () => {
      expect(content.length).toBeLessThanOrEqual(CANONICAL_MAX_CHARS);
    });

    it(`${name} has fewer than ${CANONICAL_MAX_DIRECTIVES} directives`, () => {
      const directives = content.split('\n').filter((l) => /^\s*[-*]\s|^\s*\d+\.\s/.test(l)).length;
      expect(directives).toBeLessThanOrEqual(CANONICAL_MAX_DIRECTIVES);
    });
  }

  for (const { name, content } of redirects) {
    it(`${name} stays a redirect (under ${REDIRECT_MAX_CHARS} characters)`, () => {
      expect(content.length).toBeLessThanOrEqual(REDIRECT_MAX_CHARS);
    });
  }
});

// ─── Cross-agent consistency ─────────────────────────

describe('all agent instruction files share the same project rules', () => {
  // Post ADR-038 migration: AGENTS.md + .claude/docs/* covers Claude Code (via redirect)
  // and Gemini CLI (via redirect, no docs subdir — content lives in AGENTS.md proper
  // plus .gemini/styleguide.md). Junie has its own self-contained .junie/guidelines.md.
  // The test ensures shared rules don't drift between the cross-vendor canonical and
  // the Junie canonical.
  const agentsRoot = readRoot('AGENTS.md');
  const claudeDocs = fs.existsSync(path.join(ROOT, '.claude', 'docs'))
    ? fs
        .readdirSync(path.join(ROOT, '.claude', 'docs'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => fs.readFileSync(path.join(ROOT, '.claude', 'docs', f), 'utf-8'))
        .join('\n')
    : '';
  const crossVendorCanonical = agentsRoot + '\n' + claudeDocs;
  const junieGuidelines = readRoot('.junie/guidelines.md');

  const SHARED_RULES = [
    // Git
    '`main` is protected',
    'Never amend commits on feature branches',
    'Use `Closes #NNN` in PR descriptions',
    // Environment
    'pnpm only',
    'TypeScript strict mode',
    'NEVER put secrets in config files',
    // Code Style
    '`kebab-case.ts`',
    '`err` (never `error`)',
    'no empty catches',
    'Named constants for magic numbers',
    'Zod at system boundaries',
    '`pnpm run format`',
    // Totem
    'search_knowledge',
    'NEVER use `git push --no-verify`',
    // Publishing
    '`pnpm run version`',
    // Contributor Principles
    'Update `AI_PROMPT_BLOCK` in `init.ts`',
    'GCA decline',
    'without a ticket',
  ];

  for (const rule of SHARED_RULES) {
    it(`agent canonicals contain: "${rule}"`, () => {
      expect(crossVendorCanonical).toContain(rule);
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
    'AGENTS.md',
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
