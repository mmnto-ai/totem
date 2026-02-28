import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Content, Heading, PhrasingContent } from 'mdast';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';
import type { ChunkStrategy, ContentType } from '../config-schema.js';

/**
 * Session Log Chunker — the most critical chunker.
 *
 * Preserves parent heading breadcrumbs for every content block.
 * Output: `[Session 142 > Traps > Next.js Caching] We found that...`
 */
export class SessionLogChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'session-log';

  chunk(content: string, filePath: string, type: ContentType): Chunk[] {
    const tree = unified().use(remarkParse).parse(content) as Root;
    const chunks: Chunk[] = [];

    // Heading breadcrumb stack: index = depth-1, value = heading text.
    // When we encounter a heading of depth N, we clear all headings deeper than N.
    const breadcrumbs: string[] = [];

    for (const node of tree.children) {
      if (node.type === 'heading') {
        const heading = node as Heading;
        const depth = heading.depth;
        const text = extractPlainText(heading.children);

        // Set this depth, truncate deeper levels
        breadcrumbs[depth - 1] = text;
        breadcrumbs.length = depth;
        continue;
      }

      // For any content node, emit a chunk with breadcrumb context
      const text = nodeToText(node, content);
      if (!text.trim()) continue;

      const breadcrumbPath = breadcrumbs.filter(Boolean).join(' > ');
      const contextPrefix = breadcrumbPath
        ? `[${breadcrumbPath}]`
        : `[${filePath}]`;

      const label = breadcrumbPath || filePath;
      const startLine = node.position?.start.line ?? 1;
      const endLine = node.position?.end.line ?? startLine;

      chunks.push({
        content: text.trim(),
        contextPrefix,
        filePath,
        type,
        strategy: this.strategy,
        label,
        startLine,
        endLine,
        metadata: {},
      });
    }

    return chunks;
  }
}

/** Extract plain text from mdast phrasing content nodes. */
function extractPlainText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value;
      if ('children' in n) return extractPlainText(n.children as PhrasingContent[]);
      return '';
    })
    .join('');
}

/**
 * Convert an mdast content node back to its original text
 * using the source position to slice the original content.
 */
function nodeToText(node: Content, source: string): string {
  if (node.position) {
    const lines = source.split('\n');
    const startIdx = node.position.start.line - 1;
    const endIdx = node.position.end.line;
    return lines.slice(startIdx, endIdx).join('\n');
  }
  if ('value' in node && typeof node.value === 'string') return node.value;
  return '';
}
