const XML_TAG_RE = /^[A-Za-z_][A-Za-z0-9._:-]*$/;

function assertValidTag(tag: string): void {
  if (!XML_TAG_RE.test(tag)) {
    throw new Error(`Invalid XML tag name: "${tag}"`);
  }
}

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
  assertValidTag(tag);
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escaped = content.replace(
    new RegExp(`</\\s*${safeTag}\\s*>`, 'gi'),
    (match) => `<\\/${match.slice(2)}`,
  );
  return `<${tag}>\n${escaped}\n</${tag}>`;
}

/**
 * Wrap untrusted external content (PR comments, MCP inputs, GitHub API data)
 * in XML tags with full entity escaping. All `<`, `>`, and `&` characters
 * are escaped to prevent prompt injection breakout.
 *
 * Use this for any content fetched from the network or supplied by external agents.
 * For trusted local content (git diffs), use `wrapXml()` instead.
 */
export function wrapUntrustedXml(tag: string, content: string): string {
  assertValidTag(tag);
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<${tag}>\n${escaped}\n</${tag}>`;
}
