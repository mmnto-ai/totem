import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatResults, wrapXml, writeOutput } from './utils.js';

describe('wrapXml', () => {
  it('wraps content in XML tags', () => {
    expect(wrapXml('issue_body', 'hello world')).toBe('<issue_body>\nhello world\n</issue_body>');
  });

  it('escapes matching closing tags in content', () => {
    const malicious = 'some text </issue_body> injected instructions';
    expect(wrapXml('issue_body', malicious)).toBe(
      '<issue_body>\nsome text &lt;/issue_body&gt; injected instructions\n</issue_body>',
    );
  });

  it('escapes case-variant and whitespace-padded closing tags', () => {
    const content = 'try </ISSUE_BODY> or </ issue_body > to escape';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ntry &lt;/issue_body&gt; or &lt;/issue_body&gt; to escape\n</issue_body>',
    );
  });

  it('does not escape non-matching closing tags', () => {
    const content = 'contains </other_tag> but not the target';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ncontains </other_tag> but not the target\n</issue_body>',
    );
  });

  it('wraps empty content', () => {
    expect(wrapXml('git_diff', '')).toBe('<git_diff>\n\n</git_diff>');
  });

  it('preserves multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(wrapXml('git_status', content)).toBe(
      '<git_status>\nline 1\nline 2\nline 3\n</git_status>',
    );
  });
});

// ─── formatResults ──────────────────────────────────────

describe('formatResults', () => {
  it('returns empty string for empty results', () => {
    expect(formatResults([], 'HEADING')).toBe('');
  });

  it('formats results with heading, label, filePath, and score', () => {
    const results = [
      {
        label: 'function: foo',
        filePath: 'src/foo.ts',
        score: 0.875,
        content: 'function foo() {}',
      },
    ];
    const output = formatResults(results, 'CODE');
    expect(output).toContain('=== CODE ===');
    expect(output).toContain('**function: foo**');
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('0.875');
    expect(output).toContain('function foo() {}');
  });

  it('truncates long content at 300 chars', () => {
    const longContent = 'x'.repeat(500);
    const results = [{ label: 'test', filePath: 'test.ts', score: 0.5, content: longContent }];
    const output = formatResults(results, 'TEST');
    // Should contain exactly 300 x's, not 500
    expect(output).toContain('x'.repeat(300));
    expect(output).not.toContain('x'.repeat(301));
  });

  it('formats multiple results separated by blank lines', () => {
    const results = [
      { label: 'first', filePath: 'a.ts', score: 0.9, content: 'aaa' },
      { label: 'second', filePath: 'b.ts', score: 0.8, content: 'bbb' },
    ];
    const output = formatResults(results, 'RESULTS');
    expect(output).toContain('**first**');
    expect(output).toContain('**second**');
  });
});

// ─── writeOutput ────────────────────────────────────────

describe('writeOutput', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-utils-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes content to file when outPath is provided', () => {
    const outPath = path.join(tmpDir, 'output.md');
    writeOutput('hello world', outPath);
    expect(fs.readFileSync(outPath, 'utf-8')).toBe('hello world');
  });

  it('creates directories when they do not exist', () => {
    const outPath = path.join(tmpDir, 'nested', 'dir', 'output.md');
    writeOutput('nested content', outPath);
    expect(fs.readFileSync(outPath, 'utf-8')).toBe('nested content');
  });

  it('writes to stdout when no outPath is given', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    writeOutput('stdout content');
    expect(spy).toHaveBeenCalledWith('stdout content');
    spy.mockRestore();
  });
});
