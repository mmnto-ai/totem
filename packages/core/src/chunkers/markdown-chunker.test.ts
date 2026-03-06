import { describe, expect, it } from 'vitest';

import { MarkdownChunker } from './markdown-chunker.js';

describe('MarkdownChunker', () => {
  const chunker = new MarkdownChunker(() => {});

  it('chunks by ## headings', () => {
    const md = `# Title

Some intro text.

## Section One

Content of section one.

## Section Two

Content of section two.
`;
    const chunks = chunker.chunk(md, 'docs/readme.md', 'spec');

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.label).toBe('Title');
    expect(chunks[0]!.content).toContain('Some intro text.');
    expect(chunks[1]!.label).toBe('Title > Section One');
    expect(chunks[1]!.content).toContain('Content of section one.');
    expect(chunks[2]!.label).toBe('Title > Section Two');
  });

  it('chunks by ### headings with breadcrumbs', () => {
    const md = `## Parent

Parent intro content.

### Child A

Child A content.

### Child B

Child B content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.label).toBe('Parent');
    expect(chunks[0]!.content).toContain('Parent intro content.');
    expect(chunks[1]!.label).toBe('Parent > Child A');
    expect(chunks[2]!.label).toBe('Parent > Child B');
  });

  it('does not split on #### headings', () => {
    const md = `## Section

#### Subsection

Some nested content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain('Subsection');
    expect(chunks[0]!.content).toContain('Some nested content.');
  });

  it('extracts YAML frontmatter as metadata', () => {
    const md = `---
status: implemented
date: "2025-10-12"
---

## Section

Content here.
`;
    const chunks = chunker.chunk(md, 'spec.md', 'spec');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.metadata).toEqual({
      status: 'implemented',
      date: '2025-10-12',
    });
  });

  it('sets contextPrefix with breadcrumb trail', () => {
    const md = `## My Section

Content.
`;
    const chunks = chunker.chunk(md, 'docs/api.md', 'spec');

    expect(chunks[0]!.contextPrefix).toBe('File: docs/api.md | Section: My Section');
  });

  it('sets contextPrefix with full hierarchy', () => {
    const md = `## Parent

Parent content.

### Child

Child content.
`;
    const chunks = chunker.chunk(md, 'docs/api.md', 'spec');

    expect(chunks[0]!.contextPrefix).toBe('File: docs/api.md | Section: Parent');
    expect(chunks[1]!.contextPrefix).toBe('File: docs/api.md | Section: Parent > Child');
  });

  it('sets correct line numbers', () => {
    const md = `## First

Line 3 content.

## Second

Line 7 content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[1]!.startLine).toBe(5);
  });

  it('handles empty file gracefully', () => {
    const chunks = chunker.chunk('', 'empty.md', 'spec');
    expect(chunks).toEqual([]);
  });

  it('handles file with only frontmatter', () => {
    const md = `---
title: Empty
---
`;
    const chunks = chunker.chunk(md, 'empty.md', 'spec');
    expect(chunks).toEqual([]);
  });

  it('preserves chunk type from input', () => {
    const md = `## Section\n\nContent.`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');
    expect(chunks[0]!.type).toBe('session_log');
  });

  // --- Breadcrumb-specific tests ---

  it('resets deeper breadcrumbs when sibling heading appears', () => {
    const md = `## Parent

Parent intro.

### Child A

Child A content.

### Child B

Child B content.

## Other Parent

Other content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    expect(chunks[0]!.label).toBe('Parent');
    expect(chunks[1]!.label).toBe('Parent > Child A');
    expect(chunks[2]!.label).toBe('Parent > Child B');
    expect(chunks[3]!.label).toBe('Other Parent');
  });

  it('handles dangling content before any headings', () => {
    const md = `Some intro text before any headings.

## First Section

Section content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.label).toBe('test.md');
    expect(chunks[0]!.content).toContain('Some intro text');
    expect(chunks[1]!.label).toBe('First Section');
  });

  it('handles skipped heading levels (## to ####)', () => {
    const md = `## Top

#### Deep (not a split point)

Deep content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    // #### doesn't split, so everything stays under ## Top
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('Top');
    expect(chunks[0]!.content).toContain('Deep content.');
  });

  it('builds full 3-level breadcrumb trail', () => {
    const md = `# Level 1

## Level 2

### Level 3

Deeply nested content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'spec');

    const deepChunk = chunks.find((c) => c.content.includes('Deeply nested'));
    expect(deepChunk!.label).toBe('Level 1 > Level 2 > Level 3');
  });
});
