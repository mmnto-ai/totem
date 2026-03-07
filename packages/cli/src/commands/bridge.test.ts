import { describe, expect, it } from 'vitest';

import { assembleBridge } from './bridge.js';

describe('assembleBridge', () => {
  it('generates a bridge with branch and clean status', () => {
    const output = assembleBridge('main', '');
    expect(output).toContain('# Context Bridge');
    expect(output).toContain('**Branch:** main');
    expect(output).toContain('(clean working tree)');
    expect(output).toContain('Resume work');
  });

  it('includes modified files from git status', () => {
    const status = ' M src/foo.ts\n M src/bar.ts';
    const output = assembleBridge('feat/test', status);
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('src/bar.ts');
    expect(output).not.toContain('clean working tree');
  });

  it('includes breadcrumb message when provided', () => {
    const output = assembleBridge('main', '', 'Stuck on auth bug in middleware.ts');
    expect(output).toContain('Stuck on auth bug in middleware.ts');
    expect(output).toContain('**Current Task / Breadcrumb:**');
  });

  it('omits breadcrumb section when no message provided', () => {
    const output = assembleBridge('main', '');
    expect(output).not.toContain('Breadcrumb');
  });

  it('truncates file list when more than 20 files', () => {
    const lines = Array.from({ length: 25 }, (_, i) => ` M src/file${i}.ts`);
    const status = lines.join('\n');
    const output = assembleBridge('main', status);
    expect(output).toContain('src/file0.ts');
    expect(output).toContain('src/file19.ts');
    expect(output).not.toContain('src/file20.ts');
    expect(output).toContain('and 5 more files');
  });

  it('uses singular "file" when exactly 1 file over limit', () => {
    const lines = Array.from({ length: 21 }, (_, i) => ` M src/file${i}.ts`);
    const status = lines.join('\n');
    const output = assembleBridge('main', status);
    expect(output).toContain('and 1 more file');
    expect(output).not.toContain('and 1 more files');
  });
});
