/**
 * Wrap external/user-supplied content in XML tags to create a clear boundary
 * between system instructions and passive data. Escapes matching closing tags
 * in the content using backslash escaping to prevent breakout.
 *
 * Backslash escaping is preferred over HTML entities for LLM consumption —
 * it prevents tag interpretation while maintaining readability.
 *
 * @see https://github.com/mmnto-ai/totem/issues/149
 * @see https://github.com/mmnto-ai/totem/issues/158
 */
export function wrapXml(tag: string, content: string): string {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escaped = content.replace(
    new RegExp(`</\\s*${safeTag}\\s*>`, 'gi'),
    (match) => `<\\/${match.slice(2)}`,
  );
  return `<${tag}>\n${escaped}\n</${tag}>`;
}
