/**
 * Tests for the generic fallback chunker — the fourth-language layer's Stage 1
 * (mmnto-ai/totem#2387, `totem-strategy` Proposal 256 Option A; contract:
 * mmnto-ai/totem#2308).
 *
 * Covers:
 * - Language-agnostic chunking of the lockout cases (Rust, GDScript).
 * - Fixed-size line windows with overlap + full coverage, no duplicate tail.
 * - Empty / whitespace-only input yields zero chunks.
 * - Regression-lock: registering `generic` does not degrade or hijack the
 *   existing TS routing, and `createChunker` still fail-louds on an unknown
 *   strategy (the #2308 explicit-opt-in / Tenet-4 constraint).
 */

import { describe, expect, it } from 'vitest';

import { createChunker } from './chunker.js';
import { GenericChunker } from './generic-chunker.js';

describe('GenericChunker', () => {
  const chunker = new GenericChunker();

  it('reports the generic strategy', () => {
    expect(chunker.strategy).toBe('generic');
  });

  it('chunks Rust source (the index-lockout case) language-agnostically', () => {
    const rust = `fn main() {
    println!("hello, world");
}`;
    const chunks = chunker.chunk(rust, 'src/main.rs', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.strategy).toBe('generic');
    expect(chunks[0]!.type).toBe('code');
    expect(chunks[0]!.filePath).toBe('src/main.rs');
    expect(chunks[0]!.content).toContain('fn main');
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(3);
    expect(chunks[0]!.label).toBe('src/main.rs:1-3');
    expect(chunks[0]!.contextPrefix).toBe('File: src/main.rs | Lines: 1-3');
  });

  it('chunks GDScript source language-agnostically', () => {
    const gd = `extends Node

func _ready():
    print("hi")`;
    const chunks = chunker.chunk(gd, 'player.gd', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.strategy).toBe('generic');
    expect(chunks[0]!.content).toContain('func _ready');
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(4);
  });

  it('produces overlapping fixed-size windows with full coverage for large files', () => {
    // 130 lines → windows of 60 advancing by 50: [1-60], [51-110], [101-130].
    const lines = Array.from({ length: 130 }, (_, i) => `L${i + 1}`);
    const content = lines.join('\n');
    const chunks = chunker.chunk(content, 'big.rs', 'code');

    expect(chunks.length).toBe(3);

    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(60);
    expect(chunks[1]!.startLine).toBe(51);
    expect(chunks[1]!.endLine).toBe(110);
    expect(chunks[2]!.startLine).toBe(101);
    expect(chunks[2]!.endLine).toBe(130);

    // Adjacent windows overlap (share boundary context).
    expect(chunks[1]!.startLine).toBeLessThanOrEqual(chunks[0]!.endLine);
    expect(chunks[2]!.startLine).toBeLessThanOrEqual(chunks[1]!.endLine);

    // Full coverage: first line through last line, all strategy 'generic'.
    expect(chunks[0]!.content).toContain('L1');
    expect(chunks[2]!.content).toContain('L130');
    for (const c of chunks) {
      expect(c.strategy).toBe('generic');
    }
  });

  it('emits the final partial window exactly once (no duplicate tail chunk)', () => {
    // 61 lines → [1-60] then [51-61]; the second window reaches EOF and stops.
    const content = Array.from({ length: 61 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunker.chunk(content, 'x.rs', 'code');

    expect(chunks.length).toBe(2);
    expect(chunks[1]!.endLine).toBe(61);
  });

  it('yields no chunks for empty content', () => {
    expect(chunker.chunk('', 'empty.rs', 'code')).toEqual([]);
  });

  it('yields no chunks for whitespace-only content', () => {
    expect(chunker.chunk('\n\n   \n\t\n', 'blank.rs', 'code')).toEqual([]);
  });
});

describe('GenericChunker registration (regression-lock)', () => {
  it('createChunker routes the generic strategy to GenericChunker', () => {
    const c = createChunker('generic');
    expect(c).toBeInstanceOf(GenericChunker);
    expect(c.strategy).toBe('generic');
  });

  it('does not hijack TS routing — typescript-ast still yields unchanged chunk counts', () => {
    const tsChunker = createChunker('typescript-ast');
    expect(tsChunker.strategy).toBe('typescript-ast');
    expect(tsChunker).not.toBeInstanceOf(GenericChunker);

    const code = `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;
    // Unchanged: a single function still chunks to exactly one chunk.
    expect(tsChunker.chunk(code, 'src/utils.ts', 'code').length).toBe(1);
  });

  it('preserves fail-loud — an unknown strategy still throws (never a silent fallback)', () => {
    // The generic chunker is explicit-opt-in only (mmnto-ai/totem#2308); a
    // typo names a real misconfiguration and must NOT degrade to line-windows.
    expect(() => createChunker('typo-strategy')).toThrowError(/Unknown chunk strategy/);
  });
});
