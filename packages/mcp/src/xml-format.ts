// Re-export from core — unified XML escaping (#158)
import { wrapXml } from '@mmnto/totem';

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
