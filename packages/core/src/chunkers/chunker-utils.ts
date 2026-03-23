import type { PhrasingContent } from 'mdast';

/** Extract plain text from mdast phrasing content nodes. */
export function extractPlainText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') return n.value;
      if ('children' in n) return extractPlainText(n.children as PhrasingContent[]);
      return '';
    })
    .join('');
}
