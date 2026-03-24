import { describe, expect, it } from 'vitest';

import { buildFrontmatterFromLegacy, extractFrontmatter } from './lesson-frontmatter.js';

// ─── extractFrontmatter ──────────────────────────────

describe('extractFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const content = `---
category: security
severity: warning
tags: ["auth", "jwt"]
lifecycle: nursery
---
## Lesson — Test heading

Body text.`;

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.category).toBe('security');
    expect(result.frontmatter.severity).toBe('warning');
    expect(result.frontmatter.tags).toEqual(['auth', 'jwt']);
    expect(result.frontmatter.lifecycle).toBe('nursery');
    expect(result.body).toContain('## Lesson — Test heading');
    expect(result.body).not.toContain('---');
  });

  it('returns defaults when no YAML present', () => {
    const content = `## Lesson — No frontmatter

**Tags:** foo, bar

Body.`;

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(false);
    expect(result.frontmatter.type).toBe('trap');
    expect(result.frontmatter.severity).toBe('error');
    expect(result.frontmatter.tags).toEqual([]);
    expect(result.frontmatter.lifecycle).toBe('stable');
    expect(result.body).toBe(content);
  });

  it('handles malformed YAML gracefully (fail-open)', () => {
    const warnings: string[] = [];
    const content = `---
category: [invalid
---
## Lesson — Bad yaml

Body.`;

    const result = extractFrontmatter(content, (msg) => warnings.push(msg));
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.type).toBe('trap');
    expect(result.body).toContain('## Lesson — Bad yaml');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('handles invalid field values gracefully (fail-open)', () => {
    const warnings: string[] = [];
    const content = `---
severity: critical
category: nonexistent
---
## Lesson — Bad values

Body.`;

    const result = extractFrontmatter(content, (msg) => warnings.push(msg));
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.severity).toBe('error'); // default
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('ignores ## inside YAML block (heading safety)', () => {
    const content = `---
category: architecture
tags: ["## not a heading"]
---
## Lesson — Real heading

Body.`;

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.tags).toEqual(['## not a heading']);
    expect(result.body).toContain('## Lesson — Real heading');
  });

  it('handles CRLF line endings', () => {
    const content =
      '---\r\ncategory: security\r\nseverity: warning\r\n---\r\n## Lesson — CRLF\r\n\r\nBody.\r\n';

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.category).toBe('security');
    expect(result.frontmatter.severity).toBe('warning');
    expect(result.body).toContain('## Lesson — CRLF');
  });

  it('parses compilation block', () => {
    const content = `---
compilation:
  engine: regex
  pattern: "\\\\beval\\\\("
severity: error
---
## Lesson — Eval trap

Body.`;

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.compilation?.engine).toBe('regex');
    expect(result.frontmatter.compilation?.pattern).toBe('\\beval\\(');
  });

  it('parses ecosystem with multiple frameworks', () => {
    const content = `---
ecosystem:
  frameworks: ["nextjs", "react"]
---
## Lesson — Multi-framework

Body.`;

    const result = extractFrontmatter(content);
    expect(result.frontmatter.ecosystem?.frameworks).toEqual(['nextjs', 'react']);
  });

  it('parses scope with globs', () => {
    const content = `---
scope:
  globs: ["app/**/*.tsx", "!**/*.test.tsx"]
---
## Lesson — Scoped

Body.`;

    const result = extractFrontmatter(content);
    expect(result.frontmatter.scope?.globs).toEqual(['app/**/*.tsx', '!**/*.test.tsx']);
  });

  it('applies defaults for empty YAML block', () => {
    const content = `---
---
## Lesson — Empty frontmatter

Body.`;

    const result = extractFrontmatter(content);
    expect(result.hadYaml).toBe(true);
    expect(result.frontmatter.type).toBe('trap');
    expect(result.frontmatter.severity).toBe('error');
    expect(result.frontmatter.lifecycle).toBe('stable');
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('validates rpn bounds', () => {
    const warnings: string[] = [];
    const content = `---
rpn: 15
---
## Lesson — Bad rpn

Body.`;

    const result = extractFrontmatter(content, (msg) => warnings.push(msg));
    expect(result.hadYaml).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(result.frontmatter.rpn).toBeUndefined(); // default, rpn out of range
  });

  it('accepts valid rpn', () => {
    const content = `---
rpn: 8
---
## Lesson — Valid rpn

Body.`;

    const result = extractFrontmatter(content);
    expect(result.frontmatter.rpn).toBe(8);
  });
});

// ─── buildFrontmatterFromLegacy ──────────────────────

describe('buildFrontmatterFromLegacy', () => {
  it('maps tags into frontmatter', () => {
    const fm = buildFrontmatterFromLegacy(['nextjs', 'auth'], '');
    expect(fm.tags).toEqual(['nextjs', 'auth']);
    expect(fm.type).toBe('trap');
  });

  it('maps legacy Pipeline 1 fields into compilation block', () => {
    const body = `Some text.

**Pattern:** \\beval\\(
**Engine:** regex
**Scope:** **/*.ts, **/*.js
**Severity:** warning`;

    const fm = buildFrontmatterFromLegacy([], body);
    expect(fm.compilation?.engine).toBe('regex');
    expect(fm.compilation?.pattern).toBe('\\beval\\(');
    expect(fm.scope?.globs).toEqual(['**/*.ts', '**/*.js']);
    expect(fm.severity).toBe('warning');
  });

  it('handles missing optional fields', () => {
    const fm = buildFrontmatterFromLegacy([], 'Just a body.');
    expect(fm.compilation).toBeUndefined();
    expect(fm.scope).toBeUndefined();
    expect(fm.severity).toBe('error'); // default
  });

  it('maps ast-grep engine', () => {
    const body = `**Pattern:** pattern: try { $A } catch { }
**Engine:** ast-grep
**Severity:** error`;

    const fm = buildFrontmatterFromLegacy([], body);
    expect(fm.compilation?.engine).toBe('ast-grep');
  });

  it('preserves tags alongside Pipeline 1 fields', () => {
    const body = `**Pattern:** \\bfoo\\b
**Engine:** regex
**Severity:** warning`;

    const fm = buildFrontmatterFromLegacy(['tag1', 'tag2'], body);
    expect(fm.tags).toEqual(['tag1', 'tag2']);
    expect(fm.compilation?.engine).toBe('regex');
  });
});
