import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Import the module under test — uses internal functions via the exported scanner
// We test parseMdcFile and parseCursorRulesFile indirectly through scanCursorInstructions
// since they're not exported. For unit-level tests, we test the public API.
import { scanCursorInstructions } from './cursor-adapter.js';

describe('scanCursorInstructions', () => {
  it('returns empty array when no cursor files exist', () => {
    // Use a temp dir with no cursor files
    const result = scanCursorInstructions('/nonexistent/path');
    expect(result).toEqual([]);
  });
});

// Test the parsing logic directly by importing and testing the module
// Since parseMdcFile and parseCursorRulesFile are not exported,
// we test them through integration or by creating temp files
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('mdc file parsing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-cursor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('parses .mdc file with frontmatter', () => {
    const mdcDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    fs.writeFileSync(
      path.join(mdcDir, 'no-console.mdc'),
      `---
description: No console.log in production
globs: src/**/*.ts
---

Do not use console.log in production code. Use the project's logging library instead.
`,
    );

    const result = scanCursorInstructions(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.heading).toBe('No console.log in production');
    expect(result[0]!.body).toContain('Do not use console.log');
    expect(result[0]!.globs).toEqual(['src/**/*.ts']);
  });

  it('parses .mdc file without frontmatter', () => {
    const mdcDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    fs.writeFileSync(path.join(mdcDir, 'use-pnpm.mdc'), 'Always use pnpm, never npm or yarn.');

    const result = scanCursorInstructions(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.heading).toBe('use pnpm');
    expect(result[0]!.body).toBe('Always use pnpm, never npm or yarn.');
    expect(result[0]!.globs).toBeUndefined();
  });

  it('parses .cursorrules with heading sections', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.cursorrules'),
      `# General Rules

Use TypeScript strict mode.

# Naming

Use kebab-case for file names.
`,
    );

    const result = scanCursorInstructions(tmpDir);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((r) => r.body.includes('TypeScript strict mode'))).toBe(true);
    expect(result.some((r) => r.body.includes('kebab-case'))).toBe(true);
  });

  it('skips empty files', () => {
    const mdcDir = path.join(tmpDir, '.cursor', 'rules');
    fs.mkdirSync(mdcDir, { recursive: true });
    fs.writeFileSync(path.join(mdcDir, 'empty.mdc'), '');

    const result = scanCursorInstructions(tmpDir);
    expect(result).toHaveLength(0);
  });
});
