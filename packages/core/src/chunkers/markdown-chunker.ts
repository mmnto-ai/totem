import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import YAML from 'yaml';
import type { Root, Heading, Content, PhrasingContent } from 'mdast';
import type { Chunk } from '../types.js';
import type { Chunker } from './chunker.js';
import type { ChunkStrategy, ContentType } from '../config-schema.js';

const MAX_SPLIT_DEPTH = 3;

/**
 * Markdown Heading Chunker.
 *
 * Chunks by ## and ### heading boundaries.
 * Extracts YAML frontmatter as metadata on every chunk.
 */
export class MarkdownChunker implements Chunker {
  readonly strategy: ChunkStrategy = 'markdown-heading';

  chunk(content: string, filePath: string, type: ContentType): Chunk[] {
    const tree = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ['yaml'])
      .parse(content) as Root;

    const metadata = this.extractFrontmatter(tree, filePath);
    const chunks: Chunk[] = [];
    const lines = content.split('\n');

    let currentHeading: string | null = null;
    let sectionNodes: Content[] = [];
    let sectionStartLine = 1;

    const flush = () => {
      if (sectionNodes.length === 0 && !currentHeading) return;

      const sectionText = sectionNodes
        .map((n) => nodeToSourceText(n, lines))
        .filter(Boolean)
        .join('\n\n');

      if (!sectionText.trim()) return;

      const label = currentHeading ?? filePath;
      const contextPrefix = `File: ${filePath} | Section: ${label}`;
      const endLine = sectionNodes.length > 0
        ? (sectionNodes[sectionNodes.length - 1]!.position?.end.line ?? sectionStartLine)
        : sectionStartLine;

      chunks.push({
        content: sectionText.trim(),
        contextPrefix,
        filePath,
        type,
        strategy: this.strategy,
        label,
        startLine: sectionStartLine,
        endLine,
        metadata,
      });
    };

    for (const node of tree.children) {
      // Skip YAML frontmatter node
      if (node.type === 'yaml') continue;

      if (node.type === 'heading') {
        const h = node as Heading;
        // Only split on headings up to depth 3
        if (h.depth <= MAX_SPLIT_DEPTH) {
          flush();
          currentHeading = extractPlainText(h.children);
          sectionNodes = [];
          sectionStartLine = h.position?.start.line ?? 1;
          continue;
        }
      }

      sectionNodes.push(node);
    }

    // Flush final section
    flush();

    return chunks;
  }

  private extractFrontmatter(tree: Root, filePath: string): Record<string, string> {
    const yamlNode = tree.children.find((n) => n.type === 'yaml');
    if (!yamlNode || !('value' in yamlNode)) return {};

    try {
      const parsed = YAML.parse(yamlNode.value as string);
      if (typeof parsed !== 'object' || parsed === null) return {};

      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value);
      }
      return result;
    } catch (err) {
      console.warn(
        `[Totem Warning] Failed to parse frontmatter in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }
}

function extractPlainText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value;
      if ('children' in n) return extractPlainText(n.children as PhrasingContent[]);
      return '';
    })
    .join('');
}

function nodeToSourceText(node: Content, lines: string[]): string {
  if (node.position) {
    const startIdx = node.position.start.line - 1;
    const endIdx = node.position.end.line;
    return lines.slice(startIdx, endIdx).join('\n');
  }
  if ('value' in node && typeof node.value === 'string') return node.value;
  return '';
}
