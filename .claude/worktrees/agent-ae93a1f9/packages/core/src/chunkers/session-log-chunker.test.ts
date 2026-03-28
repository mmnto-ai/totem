import { describe, expect, it } from 'vitest';

import { SessionLogChunker } from './session-log-chunker.js';

describe('SessionLogChunker', () => {
  const chunker = new SessionLogChunker();

  it('has strategy "session-log"', () => {
    expect(chunker.strategy).toBe('session-log');
  });

  // ─── Basic chunking ──────────────────────────────────

  it('chunks a session log with headings and content blocks', () => {
    const md = `# Session 142

## Traps

### Next.js Caching

We found that the app router caches aggressively.

### State Management

Redux is overkill for this project.

## Wins

### Performance

Page load dropped to 1.2s after optimizing images.
`;
    const chunks = chunker.chunk(md, 'sessions/142.md', 'session_log');

    expect(chunks.length).toBe(3);

    // First content block: under Session 142 > Traps > Next.js Caching
    expect(chunks[0]!.contextPrefix).toBe('[Session 142 > Traps > Next.js Caching]');
    expect(chunks[0]!.label).toBe('Session 142 > Traps > Next.js Caching');
    expect(chunks[0]!.content).toContain('app router caches aggressively');

    // Second content block: under Session 142 > Traps > State Management
    expect(chunks[1]!.contextPrefix).toBe('[Session 142 > Traps > State Management]');
    expect(chunks[1]!.content).toContain('Redux is overkill');

    // Third content block: under Session 142 > Wins > Performance
    expect(chunks[2]!.contextPrefix).toBe('[Session 142 > Wins > Performance]');
    expect(chunks[2]!.content).toContain('1.2s');
  });

  it('preserves chunk metadata fields', () => {
    const md = `## Section\n\nSome content here.`;
    const chunks = chunker.chunk(md, 'logs/session.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.filePath).toBe('logs/session.md');
    expect(chunks[0]!.type).toBe('session_log');
    expect(chunks[0]!.strategy).toBe('session-log');
    expect(chunks[0]!.metadata).toEqual({});
  });

  // ─── Breadcrumb behavior ─────────────────────────────

  it('resets deeper breadcrumbs when a sibling heading appears', () => {
    const md = `# Root

## Child A

### Grandchild

Grandchild content.

## Child B

Child B content.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.label).toBe('Root > Child A > Grandchild');
    // After ## Child B, the ### level is cleared
    expect(chunks[1]!.label).toBe('Root > Child B');
  });

  it('handles content before any headings using filePath as context', () => {
    const md = `Some preamble text before headings.

## First Section

Section content.
`;
    const chunks = chunker.chunk(md, 'orphan.md', 'session_log');

    expect(chunks.length).toBe(2);
    // No breadcrumbs yet, so contextPrefix uses filePath
    expect(chunks[0]!.contextPrefix).toBe('[orphan.md]');
    expect(chunks[0]!.label).toBe('orphan.md');
    expect(chunks[0]!.content).toContain('preamble text');

    // After heading, breadcrumbs take over
    expect(chunks[1]!.contextPrefix).toBe('[First Section]');
  });

  it('handles skipped heading levels (# to ###)', () => {
    const md = `# Top

### Deep

Deep content here.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    // Breadcrumb should show Top > Deep (skipping the missing ## level)
    expect(chunks[0]!.label).toBe('Top > Deep');
  });

  // ─── Edge cases ──────────────────────────────────────

  it('returns empty array for empty input', () => {
    const chunks = chunker.chunk('', 'empty.md', 'session_log');
    expect(chunks).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    const chunks = chunker.chunk('   \n\n  \n', 'blank.md', 'session_log');
    expect(chunks).toEqual([]);
  });

  it('returns empty array for heading-only input (no content nodes)', () => {
    const md = `# Just a heading\n\n## Another heading\n`;
    const chunks = chunker.chunk(md, 'headings-only.md', 'session_log');
    expect(chunks).toEqual([]);
  });

  it('handles a single content paragraph with no headings', () => {
    const md = `This is a standalone paragraph.`;
    const chunks = chunker.chunk(md, 'solo.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.contextPrefix).toBe('[solo.md]');
    expect(chunks[0]!.content).toBe('This is a standalone paragraph.');
  });

  // ─── Line numbers ───────────────────────────────────

  it('sets correct startLine and endLine from source positions', () => {
    const md = `# Title

Content on line 3.

## Section

Content on line 7.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.startLine).toBe(3);
    expect(chunks[0]!.endLine).toBe(3);
    expect(chunks[1]!.startLine).toBe(7);
    expect(chunks[1]!.endLine).toBe(7);
  });

  // ─── nodeToText via chunk output ─────────────────────

  it('converts a paragraph node back to its original text', () => {
    const md = `## Section\n\nThis is **bold** and *italic* text.`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    // nodeToText uses source positions to slice original content,
    // so markdown formatting is preserved
    expect(chunks[0]!.content).toBe('This is **bold** and *italic* text.');
  });

  it('converts a code block node back to its original text', () => {
    const md = `## Code Example

\`\`\`typescript
const x = 42;
console.log(x);
\`\`\`
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain('```typescript');
    expect(chunks[0]!.content).toContain('const x = 42;');
    expect(chunks[0]!.content).toContain('```');
  });

  it('converts a list node back to its original text', () => {
    const md = `## Tools

- Tool call: search_code
- Tool call: read_file
- Tool call: write_file
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain('- Tool call: search_code');
    expect(chunks[0]!.content).toContain('- Tool call: read_file');
    expect(chunks[0]!.content).toContain('- Tool call: write_file');
  });

  it('converts a blockquote node back to its original text', () => {
    const md = `## Assistant Response

> The key insight is that caching must be invalidated
> on every deployment.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain('> The key insight');
  });

  it('handles multiple content nodes under the same heading', () => {
    const md = `## Section

First paragraph.

Second paragraph.

- A list item
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    // Each top-level content node produces a separate chunk
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.content).toBe('First paragraph.');
    expect(chunks[1]!.content).toBe('Second paragraph.');
    expect(chunks[2]!.content).toContain('A list item');

    // All share the same breadcrumb
    for (const chunk of chunks) {
      expect(chunk.contextPrefix).toBe('[Section]');
    }
  });

  // ─── extractPlainText via heading breadcrumbs ────────

  it('extracts plain text from headings with inline formatting', () => {
    const md = `## **Bold** and *italic* heading

Content under formatted heading.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    // extractPlainText should strip formatting and produce plain text
    expect(chunks[0]!.label).toBe('Bold and italic heading');
  });

  it('extracts plain text from headings with inline code (code value is dropped)', () => {
    const md = `## The \`useState\` Hook

Details about useState.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    // Note: extractPlainText only handles 'text' nodes and nodes with 'children'.
    // inlineCode nodes have 'value' but not 'children', so their text is dropped.
    // This is the current behavior — inline code content is omitted from breadcrumbs.
    expect(chunks[0]!.label).toBe('The  Hook');
  });

  it('extracts plain text from headings with links', () => {
    const md = `## See [the docs](https://example.com)

Follow the link above.
`;
    const chunks = chunker.chunk(md, 'test.md', 'session_log');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('See the docs');
  });
});
