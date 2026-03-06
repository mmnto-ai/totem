// Re-export from core — unified XML escaping (#158)
import { wrapXml } from '@mmnto/totem';

/**
 * Alias for wrapXml — preserves the existing API used by MCP tools.
 */
export const formatXmlResponse = wrapXml;
