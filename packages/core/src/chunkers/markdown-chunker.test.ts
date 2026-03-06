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
    expect(chunks[1]!.label).toBe('Section One');
    expect(chunks[1]!.content).toContain('Content of section one.');
    expect(chunks[2]!.label).toBe('Section Two');
  });

  it('chunks by ### headings', () => {
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
    expect(chunks[1]!.label).toBe('Child A');
    expect(chunks[2]!.label).toBe('Child B');
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

  it('sets contextPrefix with file path and section label', () => {
    const md = `## My Section

Content.
`;
    const chunks = chunker.chunk(md, 'docs/api.md', 'spec');

    expect(chunks[0]!.contextPrefix).toBe('File: docs/api.md | Section: My Section');
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
});
