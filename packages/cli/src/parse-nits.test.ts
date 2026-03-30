import { describe, expect, it } from 'vitest';

import {
  parseCodeRabbitNits,
  parseCodeRabbitOutsideDiff,
  parseCodeRabbitReviewFindings,
} from './parse-nits.js';

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

  it('splits multiple nits separated by --- within a single file block (PR #1100 format)', () => {
    const body = `<details>
<summary>🧹 Nitpick comments (2)</summary><blockquote>

<details>
<summary>packages/cli/src/help.ts (2)</summary><blockquote>

\`76-91\`: **Replace repeated padding literals with a named constant.**

The \`+ 2\` padding appears twice.

---

\`59-61\`: **Avoid hardcoded CLI metadata in help output.**

Line 59/60 hardcode product text and command name.

</blockquote></details>

</blockquote></details>`;
    const nits = parseCodeRabbitNits(body);
    expect(nits.length).toBeGreaterThanOrEqual(2);
    expect(nits.some((n) => n.includes('padding literals'))).toBe(true);
    expect(nits.some((n) => n.includes('hardcoded CLI metadata'))).toBe(true);
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

// ─── Sample outside-diff blocks ──────────────────────────

const SAMPLE_OUTSIDE_DIFF_BLOCK = `<details>
<summary>⚠️ Potential issue (outside the diff range)</summary>

The \`processData\` function in \`src/utils.ts\` has a potential memory leak when handling large arrays.

</details>`;

const SAMPLE_OUTSIDE_DIFF_RANGE_BLOCK = `<details>
<summary>Outside diff range comments (3)</summary>

**src/config.ts (line 45):** Missing null check on config.options
**src/index.ts (line 12):** Unused import

</details>`;

// ─── parseCodeRabbitOutsideDiff ──────────────────────────

describe('parseCodeRabbitOutsideDiff', () => {
  it('extracts "outside the diff" content from a CR review body', () => {
    const results = parseCodeRabbitOutsideDiff(SAMPLE_OUTSIDE_DIFF_BLOCK);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('processData');
    expect(results[0]).toContain('memory leak');
  });

  it('extracts "Outside diff range" content from a CR review body', () => {
    const results = parseCodeRabbitOutsideDiff(SAMPLE_OUTSIDE_DIFF_RANGE_BLOCK);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('Missing null check');
    expect(results[0]).toContain('Unused import');
  });

  it('returns empty array when no outside-diff blocks exist', () => {
    const body = `## Summary\n\nNo outside diff blocks here.\n\n<details>\n<summary>Some other section</summary>\nContent.\n</details>`;
    expect(parseCodeRabbitOutsideDiff(body)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseCodeRabbitOutsideDiff('')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const body = `<details>
<summary>OUTSIDE THE DIFF findings</summary>

An uppercase outside-diff finding.

</details>`;
    const results = parseCodeRabbitOutsideDiff(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('uppercase outside-diff finding');
  });

  it('handles multiple outside-diff blocks', () => {
    const body = `${SAMPLE_OUTSIDE_DIFF_BLOCK}

Some text between blocks.

${SAMPLE_OUTSIDE_DIFF_RANGE_BLOCK}`;
    const results = parseCodeRabbitOutsideDiff(body);
    expect(results).toHaveLength(2);
    expect(results[0]).toContain('processData');
    expect(results[1]).toContain('Missing null check');
  });

  it('does not match nitpick blocks', () => {
    const nitsOnly = `<details>
<summary>🧹 Nitpick comments (1)</summary>

A nit, not an outside-diff finding.

</details>`;
    expect(parseCodeRabbitOutsideDiff(nitsOnly)).toEqual([]);
  });

  it('strips wrapper HTML tags but preserves content', () => {
    const body = `<details>
<summary>⚠️ outside the diff issue</summary><blockquote>

Important finding here.

</blockquote></details>`;
    const results = parseCodeRabbitOutsideDiff(body);
    expect(results).toHaveLength(1);
    expect(results[0]).not.toMatch(/<\/?blockquote>/);
    expect(results[0]).toContain('Important finding here');
  });
});

// ─── parseCodeRabbitReviewFindings ───────────────────────

describe('parseCodeRabbitReviewFindings', () => {
  it('returns typed results for both nitpicks and outside-diff findings', () => {
    const body = `${SAMPLE_NIT_BLOCK}

${SAMPLE_OUTSIDE_DIFF_BLOCK}`;
    const findings = parseCodeRabbitReviewFindings(body);

    const nits = findings.filter((f) => f.type === 'nitpick');
    const outsideDiff = findings.filter((f) => f.type === 'outside-diff');

    expect(nits.length).toBeGreaterThanOrEqual(1);
    expect(outsideDiff).toHaveLength(1);
    expect(outsideDiff[0]!.content).toContain('processData');
  });

  it('returns empty array when no matching blocks exist', () => {
    const body = '## Summary\n\nJust a normal review.';
    expect(parseCodeRabbitReviewFindings(body)).toEqual([]);
  });

  it('returns only nitpicks when no outside-diff blocks exist', () => {
    const findings = parseCodeRabbitReviewFindings(SAMPLE_NIT_BLOCK);
    expect(findings.every((f) => f.type === 'nitpick')).toBe(true);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('returns only outside-diff when no nitpick blocks exist', () => {
    const findings = parseCodeRabbitReviewFindings(SAMPLE_OUTSIDE_DIFF_BLOCK);
    expect(findings.every((f) => f.type === 'outside-diff')).toBe(true);
    expect(findings).toHaveLength(1);
  });
});
