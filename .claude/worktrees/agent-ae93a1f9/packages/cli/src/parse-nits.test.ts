import { describe, expect, it } from 'vitest';

import { parseCodeRabbitNits } from './parse-nits.js';

// ─── Sample CodeRabbit nit block ─────────────────────────

const SAMPLE_NIT_BLOCK = `<details>
<summary>🧹 Nitpick comments (2)</summary><blockquote>

<details>
<summary>packages/cli/src/commands/docs.ts (1)</summary><blockquote>

\`194-206\`: **Hardcoded path and fragile counting method.**

Two observations about the baseline counting logic.

</blockquote></details>
<details>
<summary>packages/core/src/rule-tester.ts (1)</summary><blockquote>

\`103-103\`: **Consider propagating \`onWarn\` to \`matchAstGrepPattern\` calls.**

Both calls omit the optional \`onWarn\` parameter.

</blockquote></details>

</blockquote></details>`;

// ─── parseCodeRabbitNits ─────────────────────────────────

describe('parseCodeRabbitNits', () => {
  it('extracts nit content from a standard CodeRabbit review body', () => {
    const nits = parseCodeRabbitNits(SAMPLE_NIT_BLOCK);
    expect(nits).toHaveLength(1);
    expect(nits[0]).toContain('Hardcoded path and fragile counting method');
    expect(nits[0]).toContain('Consider propagating');
    expect(nits[0]).toContain('Both calls omit the optional');
  });

  it('returns empty array when no nit section exists', () => {
    const body = `## Summary

This PR adds a new feature. No nitpick blocks here.

<details>
<summary>Some other section</summary>
Content that is not nits.
</details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(0);
  });

  it('handles multiple nit blocks', () => {
    const body = `<details>
<summary>🧹 Nitpick comments (1)</summary><blockquote>

First batch of nits.

</blockquote></details>

Some text in between.

<details>
<summary>🧹 Nitpick comments (1)</summary><blockquote>

Second batch of nits.

</blockquote></details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(2);
    expect(nits[0]).toContain('First batch of nits');
    expect(nits[1]).toContain('Second batch of nits');
  });

  it('strips HTML wrapper tags but preserves content', () => {
    const nits = parseCodeRabbitNits(SAMPLE_NIT_BLOCK);
    expect(nits).toHaveLength(1);
    // Wrapper tags should be stripped
    expect(nits[0]).not.toMatch(/<\/?details>/);
    expect(nits[0]).not.toMatch(/<\/?blockquote>/);
    expect(nits[0]).not.toMatch(/<summary>/);
    // Content should be preserved
    expect(nits[0]).toContain('Hardcoded path');
    expect(nits[0]).toContain('Two observations about the baseline counting logic');
  });

  it('matches case-insensitively on "Nitpick"', () => {
    const body = `<details>
<summary>nitpick comments (1)</summary>

A lowercase nit.

</details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(1);
    expect(nits[0]).toContain('A lowercase nit');
  });

  it('matches on broom emoji without the word "nitpick"', () => {
    const body = `<details>
<summary>🧹 Minor comments (1)</summary>

A broom-emoji nit.

</details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(1);
    expect(nits[0]).toContain('A broom-emoji nit');
  });

  it('returns empty array for empty string', () => {
    expect(parseCodeRabbitNits('')).toEqual([]);
  });

  it('does not catastrophically backtrack on large inputs', () => {
    // Build a large body with no matching blocks
    const large = 'x'.repeat(100_000);
    const start = performance.now();
    const nits = parseCodeRabbitNits(large);
    const elapsed = performance.now() - start;
    expect(nits).toHaveLength(0);
    // Should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });

  it('handles nit block embedded in a larger review body', () => {
    const body = `## Walkthrough

This PR refactors the compiler module.

## Changes

| File | Summary |
|------|---------|
| compiler.ts | Extracted utility |

<details>
<summary>🧹 Nitpick comments (1)</summary><blockquote>

\`42-50\`: **Consider using a Map instead of a plain object.**

Maps provide better iteration guarantees.

</blockquote></details>

## Assessment

Overall looks good.`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(1);
    expect(nits[0]).toContain('Consider using a Map');
  });

  it('skips blocks with empty content after stripping tags', () => {
    const body = `<details>
<summary>🧹 Nitpick comments (0)</summary><blockquote>
</blockquote></details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits).toHaveLength(0);
  });
});
