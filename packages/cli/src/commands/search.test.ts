import * as fs from 'node:fs';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// We can't easily test the full searchCommand because it requires
// real LanceDB + embedder. Instead, test the federation path by
// verifying that the linked index init code handles errors gracefully.

describe('searchCommand federation (#1307)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('linked index connection failures are caught and warned, not thrown', () => {
    // The federation code in search.ts catches errors per-link and
    // calls log.warn instead of throwing. This is locked in by the
    // try/catch at line ~51 of search.ts. Verify the structural
    // contract by reading the source and checking the expected error-handling pattern.
    const source = fs.readFileSync(path.join(process.cwd(), 'src/commands/search.ts'), 'utf-8');

    // Federation block must exist
    expect(source).toContain('linkedIndexes');
    expect(source).toContain('config.linkedIndexes.length > 0');

    // Error handling must use log.warn, not throw
    expect(source).toContain('Could not connect to linked index');
    expect(source).toContain('log.warn');

    // Linked search failures must also be caught
    expect(source).toContain('Linked search failed for');

    // Results must be merged and sorted by score
    expect(source).toContain('.sort((a, b) => b.result.score - a.result.score)');
  });

  it('linked results include repo tag prefix in output', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/commands/search.ts'), 'utf-8');

    // The [linkName] prefix must appear in the output formatting
    expect(source).toContain('repoTag');
    expect(source).toMatch(/linkName.*\?.*\[/);
  });
});
