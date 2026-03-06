/**
 * Wraps content in XML delimiters with escaped closing tags to prevent
 * indirect prompt injection when MCP tool responses are consumed by LLMs.
 *
 * @see https://github.com/mmnto-ai/totem/issues/149
 */
export function formatXmlResponse(tag: string, content: string): string {
  const escaped = content.replace(
    new RegExp(`</${tag}>`, 'gi'),
    (match) => `<\\/${match.slice(2)}`,
  );
  return `<${tag}>\n${escaped}\n</${tag}>`;
}
