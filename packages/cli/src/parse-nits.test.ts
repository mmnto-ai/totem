import { describe, expect, it } from 'vitest';

import {
  parseCodeRabbitNits,
  parseCodeRabbitOutsideDiff,
  parseCodeRabbitReviewFindings,
  parseGreptileOutsideDiff,
  parseGreptileReviewFindings,
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

// ─── Greptile summary parser (marker-anchored — mmnto-ai/totem#2192) ──────────
//
// Anchored on the canonical `<!-- greptile_other_comments_section -->` marker
// (mmnto-ai/totem-strategy#690), NOT a sampled <details> shape — greptile edits
// its summary in place, so a closed PR shows the marker with content removed
// post-resolution. The marker placement (below the flowchart, above the
// `<sub>Reviews>` footer) mirrors the real strategy#689 structure; the exact
// rendering of findings UNDER the marker is validated against a live out-of-diff
// sample (this fix's own PR or the next one).

const GREPTILE_WITH_OUTSIDE_DIFF = `<h3>Greptile Summary</h3>

Some prose summary.

<h3>Flowchart</h3>

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

<!-- greptile_other_comments_section -->

\`src/scorer.ts\`: the exposure floor is accepted but never checked in Step 2.

<sub>Reviews (2): Last reviewed commit … | Re-trigger Greptile</sub>`;

const GREPTILE_RESOLVED = `<h3>Greptile Summary</h3>

Confidence Score: 5/5 — safe to merge.

<!-- greptile_other_comments_section -->

<sub>Reviews (3): Last reviewed commit … | Re-trigger Greptile</sub>`;

describe('parseGreptileOutsideDiff (marker-anchored)', () => {
  it('extracts the section under the greptile_other_comments_section marker', () => {
    const results = parseGreptileOutsideDiff(GREPTILE_WITH_OUTSIDE_DIFF);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('exposure floor');
  });

  it('drops the trailing <sub>Reviews</sub> footer from the extracted section', () => {
    const results = parseGreptileOutsideDiff(GREPTILE_WITH_OUTSIDE_DIFF);
    expect(results[0]).not.toMatch(/Re-trigger Greptile/);
    expect(results[0]).not.toMatch(/<sub\b/i);
  });

  it('returns empty when the marker is present but the section is resolved/empty', () => {
    // The post-resolution state: marker remains, content edited away.
    expect(parseGreptileOutsideDiff(GREPTILE_RESOLVED)).toEqual([]);
  });

  it('returns empty when the marker is absent', () => {
    const body = `<h3>Greptile Summary</h3>\n\nConfidence Score: 5/5\n\nSafe to merge.`;
    expect(parseGreptileOutsideDiff(body)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseGreptileOutsideDiff('')).toEqual([]);
  });

  it('splits multiple findings on `---` rules outside code fences (CR #2246)', () => {
    const body = [
      '<!-- greptile_other_comments_section -->',
      '',
      '`src/a.ts`: first finding.',
      '',
      '---',
      '',
      '`src/b.ts`: second finding.',
      '',
      '<sub>Reviews (2): Last reviewed commit … | Re-trigger Greptile</sub>',
    ].join('\n');
    expect(parseGreptileOutsideDiff(body)).toEqual([
      '`src/a.ts`: first finding.',
      '`src/b.ts`: second finding.',
    ]);
  });

  it('preserves fenced code blocks and does NOT split on an in-fence `---` (gemini #2246)', () => {
    const fence = '```';
    const body = [
      '<!-- greptile_other_comments_section -->',
      '',
      'Suggested fix:',
      `${fence}ts`,
      'const x = 1;',
      '---', // a rule-looking line INSIDE the fence must not split
      'const y = 2;',
      fence,
      '',
      '<sub>Reviews (1): … | Re-trigger Greptile</sub>',
    ].join('\n');
    const results = parseGreptileOutsideDiff(body);
    expect(results).toHaveLength(1); // not split by the in-fence `---`
    expect(results[0]).toContain('const x = 1;'); // code preserved, not stripped
    expect(results[0]).toContain('const y = 2;');
    expect(results[0]).toContain(fence);
  });

  it('anchors footer removal to the Reviews footer, preserving an inner <sub> (CR #2246)', () => {
    const body = [
      '<!-- greptile_other_comments_section -->',
      '',
      'Finding with an inline <sub>subscript</sub> that must survive.',
      '',
      '<sub>Reviews (1): … | Re-trigger Greptile</sub>',
    ].join('\n');
    const results = parseGreptileOutsideDiff(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain('subscript');
    expect(results[0]).not.toMatch(/Re-trigger Greptile/);
  });
});

describe('parseGreptileReviewFindings (marker-anchored)', () => {
  it('types the extracted section as outside-diff findings', () => {
    const findings = parseGreptileReviewFindings(GREPTILE_WITH_OUTSIDE_DIFF);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('outside-diff');
    expect(findings[0]!.content).toContain('exposure floor');
  });

  it('returns empty array when the marker section is absent', () => {
    expect(parseGreptileReviewFindings('## Just a normal summary.')).toEqual([]);
  });
});

// ─── Blockquoted review-details + Additional comments (mmnto-ai/totem#2414) ───

// The live #2422 round-2 shape: CR renders the whole Review-details region as a
// markdown BLOCKQUOTE (`> ` line prefixes), which broke every section regex —
// both same-day #2414 specimens were this class. Structure mirrors the captured
// body: outside-diff section → nested per-file block → finding entry.
const BLOCKQUOTED_OUTSIDE_DIFF = [
  '**Actionable comments posted: 0**',
  '',
  '<details>',
  '<summary>📜 Review details</summary>',
  '',
  '> <details>',
  '> <summary>⚠️ Outside diff range comments (1)</summary><blockquote>',
  '> ',
  '> <details>',
  '> <summary>packages/cli/src/commands/install-hooks.ts (1)</summary><blockquote>',
  '> ',
  '> `831-838`: _🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_',
  '> ',
  '> **Distinguish an unresolved hooks directory from a hook-manager skip.**',
  '> ',
  '> Returning `null` here conflates both outcomes.',
  '> ',
  '> </blockquote></details>',
  '> ',
  '> </blockquote></details>',
  '',
  '</details>',
].join('\n');

const ADDITIONAL_COMMENTS_MIXED = [
  '<details>',
  '<summary>🔇 Additional comments (2)</summary><blockquote>',
  '',
  '<details>',
  '<summary>packages/cli/src/commands/install-hooks-exit-contract.test.ts (2)</summary><blockquote>',
  '',
  '`23-23`: _📐 Maintainability_ | _🟡 Minor_',
  '',
  '**Static test import question.**',
  '',
  'The new test file statically imports the module under test.',
  '',
  '---',
  '',
  '`1-10`: ✅ Verified — the roster invariant test covers all six artifacts. LGTM.',
  '',
  '</blockquote></details>',
  '',
  '</blockquote></details>',
].join('\n');

describe('blockquoted CR review bodies (mmnto-ai/totem#2414)', () => {
  it('parses the outside-diff section through the blockquote wrapper (the live-miss shape)', () => {
    const findings = parseCodeRabbitReviewFindings(BLOCKQUOTED_OUTSIDE_DIFF);
    const outside = findings.filter((f) => f.type === 'outside-diff');
    expect(outside).toHaveLength(1);
    expect(outside[0]!.content).toContain('Distinguish an unresolved hooks directory');
  });

  it('attributes the finding to the nested per-file block, not "(review body)"', () => {
    const findings = parseCodeRabbitReviewFindings(BLOCKQUOTED_OUTSIDE_DIFF);
    expect(findings[0]!.file).toBe('packages/cli/src/commands/install-hooks.ts');
  });

  it('parses blockquoted nit sections too (shared normalization)', () => {
    const quoted = SAMPLE_NIT_BLOCK.split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    const nits = parseCodeRabbitNits(quoted);
    expect(nits).toHaveLength(1);
    expect(nits[0]).toContain('Hardcoded path and fragile counting method');
  });

  it('legacy non-blockquoted bodies are unaffected', () => {
    const flat = BLOCKQUOTED_OUTSIDE_DIFF.replace(/^> /gm, '').replace(/^>$/gm, '');
    const findings = parseCodeRabbitReviewFindings(flat);
    expect(findings.filter((f) => f.type === 'outside-diff')).toHaveLength(1);
  });
});

describe('parseCodeRabbitReviewFindings — Additional comments (body-only, mmnto-ai/totem#2414)', () => {
  it('surfaces the severity-tagged actionable entry as a body-only finding', () => {
    const findings = parseCodeRabbitReviewFindings(ADDITIONAL_COMMENTS_MIXED);
    const bodyOnly = findings.filter((f) => f.type === 'body-only');
    expect(bodyOnly).toHaveLength(1);
    expect(bodyOnly[0]!.content).toContain('Static test import question');
    expect(bodyOnly[0]!.file).toBe('packages/cli/src/commands/install-hooks-exit-contract.test.ts');
  });

  it('filters verification/LGTM entries that carry no finding template', () => {
    const findings = parseCodeRabbitReviewFindings(ADDITIONAL_COMMENTS_MIXED);
    expect(findings.some((f) => f.content.includes('LGTM'))).toBe(false);
  });

  it('returns nothing for an Additional-comments section of pure verifications', () => {
    const pure = ADDITIONAL_COMMENTS_MIXED.replace(
      /_📐 Maintainability_ \| _🟡 Minor_/,
      '',
    ).replace(/\*\*Static test import question\.\*\*/, '✅ fine');
    const findings = parseCodeRabbitReviewFindings(pure);
    expect(findings.filter((f) => f.type === 'body-only')).toHaveLength(0);
  });
});

describe('CR_SEVERITY_TAG_RE anchoring + file-block scan position (#2427 review round)', () => {
  function additionalSection(entry: string): string {
    return [
      '<details>',
      '<summary>🔇 Additional comments (1)</summary><blockquote>',
      '<details>',
      '<summary>packages/cli/src/x.ts (1)</summary><blockquote>',
      '',
      entry,
      '',
      '</blockquote></details>',
      '</blockquote></details>',
    ].join('\n');
  }

  it('italic prose merely CONTAINING a severity word is not actionable (CR example)', () => {
    const findings = parseCodeRabbitReviewFindings(
      additionalSection('`5-5`: _major version verified_ — bump is safe. LGTM.'),
    );
    expect(findings.filter((f) => f.type === 'body-only')).toHaveLength(0);
  });

  it('a bare italic severity word inside a sentence is not actionable (greptile example)', () => {
    const findings = parseCodeRabbitReviewFindings(
      additionalSection('`5-10`: ✅ Fixed the _minor_ nit. LGTM.'),
    );
    expect(findings.filter((f) => f.type === 'body-only')).toHaveLength(0);
  });

  it('the real emoji-prefixed template still qualifies', () => {
    const findings = parseCodeRabbitReviewFindings(
      additionalSection('`5-5`: _📐 Maintainability_ | _🟡 Minor_\n\n**A real finding.**'),
    );
    expect(findings.filter((f) => f.type === 'body-only')).toHaveLength(1);
  });

  it('a path-like details block NESTED in a finding body is not re-matched as a sibling file block', () => {
    const body = [
      '<details>',
      '<summary>⚠️ Outside diff range comments (1)</summary><blockquote>',
      '<details>',
      '<summary>packages/cli/src/outer.ts (1)</summary><blockquote>',
      '',
      '`1-2`: _🟠 Major_ finding text.',
      '',
      '<details>',
      '<summary>packages/cli/src/inner.ts (1)</summary><blockquote>',
      'embedded illustration, not a sibling block',
      '</blockquote></details>',
      '',
      '</blockquote></details>',
      '</blockquote></details>',
    ].join('\n');
    const findings = parseCodeRabbitReviewFindings(body).filter((f) => f.type === 'outside-diff');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.file).toBe('packages/cli/src/outer.ts');
  });
});
