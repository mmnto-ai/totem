// Re-export from core — unified XML escaping (#158)
import { wrapXml } from '@mmnto/totem';

import type { IndexState } from './schemas/describe-project.js';

/**
 * Alias for wrapXml — preserves the existing API used by MCP tools.
 */
export const formatXmlResponse = wrapXml;

/**
 * Emit an invisible system warning that instructs the AI to act on context pressure.
 * The AI should read this silently and synthesize a natural-language warning — not echo it raw.
 */
export function formatSystemWarning(message: string): string {
  return wrapXml('totem_system_warning', message);
}

/**
 * Emit a self-closing `<index-meta>` envelope describing knowledge-index
 * freshness (mmnto-ai/totem#2029). Prepended to search_knowledge responses
 * so consumers see staleness alongside results without re-deriving it.
 *
 * Two shapes:
 *   - Populated: `<index-meta lastSyncAt="ISO" staleness="N ago" />`
 *   - Null      : `<index-meta status="no-index" />` (lite tier / pre-first-sync)
 *
 * Attribute values are escaped per XML 1.0: `&` first (so subsequent
 * substitutions cannot double-escape), then `"`, then `<`. Although the
 * sources today are canonical ISO timestamps from `runSync` plus the
 * controlled-vocabulary `formatStaleness` output, the inputs flow through
 * filesystem reads of `index-meta.json` and `index-manifest.json` which a
 * hand-edit or downstream tool could conceivably contaminate (CR R1 +
 * GCA R1 convergent catch on mmnto-ai/totem#2033).
 */
export function formatIndexEnvelope(indexState: IndexState): string {
  if (indexState.lastSyncAt === null) {
    return '<index-meta status="no-index" />';
  }
  const last = escapeAttr(indexState.lastSyncAt);
  const stale = escapeAttr(indexState.staleness ?? '');
  return `<index-meta lastSyncAt="${last}" staleness="${stale}" />`;
}

/**
 * Replacer functions (not replacement strings) are deliberate: passing
 * `'&quot;'` to `String.prototype.replace` would interpret `$&` as a
 * back-reference to the match. Using `() => '...'` blocks that substitution
 * (GCA R1 defense-in-depth catch). The order `&` → `"` → `<` matters:
 * escaping `&` AFTER `"` would double-escape the `&` in `&quot;`.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, () => '&amp;')
    .replace(/"/g, () => '&quot;')
    .replace(/</g, () => '&lt;');
}
