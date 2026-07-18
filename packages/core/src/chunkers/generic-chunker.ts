import type { ChunkStrategy, ContentType } from '../config-schema.js';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';

/**
 * Generic Fallback Chunker — the fourth-language layer's Stage 1
 * (mmnto-ai/totem#2387, `totem-strategy` Proposal 256 Option A).
 *
 * A language-agnostic, fixed-size line-window chunker with overlap. It carries
 * no per-language semantics and does no AST parsing; it exists so that source
 * with no dedicated chunker yet (Rust, GDScript, …) can be indexed for
 * retrieval AT ALL instead of being locked out of the index. The embedding
 * model carries the semantic resolution — this strategy is precision-poor by
 * design (Tenet 19 consumer-impact framing) and is superseded per-language by
 * the Stage 2 AST chunkers (`rust-ast`, …) as they ship.
 *
 * Selection is EXPLICIT-OPT-IN ONLY (mmnto-ai/totem#2308): a consumer reaches
 * this strategy by NAMING `'generic'` on a target in `totem.config.ts`. It is
 * a normal registered built-in like any other — it is NEVER an implicit
 * catch-all. `createChunker('typo-strategy')` still fail-louds per Tenet 4; a
 * misspelled strategy names a real misconfiguration and must not silently
 * degrade to line-windows.
 *
 * Windowing: a sliding window of {@link GENERIC_WINDOW_LINES} lines advancing
 * by {@link GENERIC_STEP_LINES} (window minus {@link GENERIC_OVERLAP_LINES}),
 * so adjacent chunks share their boundary context. The final partial window is
 * emitted exactly once and terminates the walk — no duplicate overlap-only
 * tail chunk. Blank/whitespace-only windows are dropped so trailing newlines
 * never yield empty chunks.
 */

/** Lines per window. Precision-poor by design; the embedder resolves semantics. */
const GENERIC_WINDOW_LINES = 60;

/** Lines shared between adjacent windows so boundary context is not severed. */
const GENERIC_OVERLAP_LINES = 10;

/**
 * Window advance per step. Must be > 0 (i.e. overlap < window) or the walk
 * would never terminate; the invariant holds by construction for the constants
 * above and is the reason overlap is defined as strictly less than the window.
 */
const GENERIC_STEP_LINES = GENERIC_WINDOW_LINES - GENERIC_OVERLAP_LINES;

export class GenericChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'generic';

  chunk(content: string, filePath: string, type: ContentType): Chunk[] {
    const rawLines = content.split('\n');
    // A file ending in a newline (the norm for real source) splits into a
    // phantom empty final element — without stripping it, the EOF check misses
    // by one and the final window over-reports `endLine` past the real last
    // line (greptile P1 on #2442). Strip exactly ONE trailing empty element:
    // it is the artifact of the final newline; further empties are REAL blank
    // lines.
    const lines =
      rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
        ? rawLines.slice(0, -1)
        : rawLines;
    const chunks: Chunk[] = [];

    for (let start = 0; start < lines.length; start += GENERIC_STEP_LINES) {
      const end = Math.min(start + GENERIC_WINDOW_LINES, lines.length);
      const windowLines = lines.slice(start, end);
      const text = windowLines.join('\n');

      // Drop empty / whitespace-only windows (e.g. a run of trailing blank
      // lines) so we never embed an empty chunk.
      if (text.trim()) {
        const startLine = start + 1;
        const endLine = end; // 0-indexed exclusive `end` == 1-indexed inclusive last line
        const label = `${filePath}:${startLine}-${endLine}`;

        chunks.push({
          content: text,
          contextPrefix: `File: ${filePath} | Lines: ${startLine}-${endLine}`,
          filePath,
          type,
          strategy: this.strategy,
          label,
          startLine,
          endLine,
          metadata: {},
        });
      }

      // The window reached the end of the file — the final (possibly partial)
      // window has been emitted; stop so we never append a duplicate tail that
      // is fully contained in the window just produced.
      if (end >= lines.length) break;
    }

    return chunks;
  }
}
