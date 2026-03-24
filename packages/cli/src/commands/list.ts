import fs from 'node:fs';

import { readRegistry } from '@mmnto/totem';

export function listCommand(): void {
  const registry = readRegistry();
  const entries = Object.values(registry);

  if (entries.length === 0) {
    console.error(
      '[Totem] No workspaces registered. Run `totem sync` in a project to register it.',
    );
    return;
  }

  // Sort by lastSync descending
  entries.sort((a, b) => new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime());

  const now = Date.now();
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;

  console.error('[Totem] Registered workspaces:\n');

  for (const entry of entries) {
    const age = now - new Date(entry.lastSync).getTime();
    const relTime = formatRelativeTime(age);
    const exists = fs.existsSync(entry.path);
    const stale = age > STALE_MS;

    const flags: string[] = [];
    if (!exists) flags.push('[MISSING]');
    if (stale) flags.push('[STALE]');

    const flagStr = flags.length > 0 ? ' ' + flags.join(' ') : '';

    console.error(`  ${entry.path}`);
    console.error(
      `    Chunks: ${entry.chunkCount}  |  Synced: ${relTime}  |  Embedder: ${entry.embedder}${flagStr}`,
    );
    console.error('');
  }
}

export function formatRelativeTime(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
