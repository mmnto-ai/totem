import { describe, expect, it } from 'vitest';

import {
  COMPILER_SYSTEM_PROMPT,
  KIND_ALLOW_LIST,
  PIPELINE3_COMPILER_PROMPT,
} from './compile-templates.js';

describe('COMPILER_SYSTEM_PROMPT', () => {
  it('includes Identity and Rules sections', () => {
    expect(COMPILER_SYSTEM_PROMPT).toContain('## Identity');
    expect(COMPILER_SYSTEM_PROMPT).toContain('## Rules');
  });

  it('includes Output Schema', () => {
    expect(COMPILER_SYSTEM_PROMPT).toContain('## Output Schema');
  });

  it('includes glob syntax instructions', () => {
    expect(COMPILER_SYSTEM_PROMPT).toContain('**/');
    expect(COMPILER_SYSTEM_PROMPT).toContain('Supported glob syntax only');
  });

  // ─── Compound rules (mmnto-ai/totem#1409) ──────────

  it('contains a Compound rules section with structural combinators', () => {
    expect(COMPILER_SYSTEM_PROMPT).toContain('Compound rules');
    expect(COMPILER_SYSTEM_PROMPT).toContain('inside');
    expect(COMPILER_SYSTEM_PROMPT).toContain('has');
    expect(COMPILER_SYSTEM_PROMPT).toContain('not');
    expect(COMPILER_SYSTEM_PROMPT).toContain('kind:');
  });

  it('renames the misleading Compound patterns heading to Flat patterns', () => {
    // The pre-#1409 prompt had a section titled "Compound patterns (method
    // calls with specific arguments)" whose examples were actually flat
    // single-node patterns using $$$ captures. That mislabel taught the
    // LLM to call flat rules "compound" and blurred the boundary. The
    // rewrite uses the Flat patterns heading for those examples and
    // reserves "Compound rules" for true structural combinators.
    expect(COMPILER_SYSTEM_PROMPT).not.toContain(
      'Compound patterns (method calls with specific arguments)',
    );
    expect(COMPILER_SYSTEM_PROMPT).toContain('Flat patterns');
  });

  it('interpolates at least three KIND_ALLOW_LIST entries verbatim', () => {
    let hits = 0;
    for (const kind of KIND_ALLOW_LIST) {
      if (COMPILER_SYSTEM_PROMPT.includes(kind)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it('forbids the inside-pattern sharp edge from the spike findings (G-3)', () => {
    // The for-loop inside-pattern shape silently matches zero per
    // compound.spike.test.ts:247. The prompt must steer Sonnet away.
    expect(COMPILER_SYSTEM_PROMPT).toMatch(/for \(\$[A-Z]+; \$[A-Z]+; \$[A-Z]+\)/);
  });

  it('has a Bad Example section that flags the field as required', () => {
    expect(COMPILER_SYSTEM_PROMPT).toContain('Bad Example (REQUIRED)');
    expect(COMPILER_SYSTEM_PROMPT).toContain('badExample');
  });

  it('shows badExample in the ast-grep output schema example', () => {
    // The LLM leans heavily on the literal output schema block, so the
    // JSON template must visibly carry badExample for the field to land
    // in real responses. Count occurrences of the literal "badExample"
    // key in triple-quoted code blocks as a proxy for "shows up in the
    // example JSON".
    const occurrences = COMPILER_SYSTEM_PROMPT.match(/"badExample":/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });
});

describe('PIPELINE3_COMPILER_PROMPT', () => {
  it('includes Identity section', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('## Identity');
  });

  it('includes Strategy section', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('## Strategy');
  });

  it('includes Output Schema', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('## Output Schema');
  });

  it('mentions Bad and Good code snippets', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Bad Code');
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Good Code');
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Bad');
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Good');
  });

  it('includes glob syntax instructions', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('**/');
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Supported glob syntax only');
  });

  it('specifies compilable true and false schemas', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('"compilable": true');
    expect(PIPELINE3_COMPILER_PROMPT).toContain('"compilable": false');
  });

  it('requires JSON-only output', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Output ONLY valid JSON');
  });

  it('identifies itself as Pipeline 3', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('Pipeline 3');
  });

  // ─── badExample requirement (mmnto-ai/totem#1409) ──

  it('teaches Pipeline 3 to emit a badExample field', () => {
    expect(PIPELINE3_COMPILER_PROMPT).toContain('badExample');
  });
});

// ─── Test-Contract Scope Classifier (mmnto-ai/totem#1626) ──

describe('Test-Contract Scope Classifier (mmnto-ai/totem#1626)', () => {
  describe('COMPILER_SYSTEM_PROMPT', () => {
    it('declares the classifier section with the #1626 issue reference', () => {
      expect(COMPILER_SYSTEM_PROMPT).toContain('Test-Contract Scope Classifier');
      expect(COMPILER_SYSTEM_PROMPT).toContain('mmnto-ai/totem#1626');
    });

    it('names the testing tag as a positive classifier signal', () => {
      expect(COMPILER_SYSTEM_PROMPT).toMatch(/`testing`\s+tag/);
    });

    it('enumerates the broad test-inclusive glob set so monorepo layouts are covered', () => {
      expect(COMPILER_SYSTEM_PROMPT).toContain('**/*.test.*');
      expect(COMPILER_SYSTEM_PROMPT).toContain('**/*.spec.*');
      expect(COMPILER_SYSTEM_PROMPT).toContain('**/tests/**');
      expect(COMPILER_SYSTEM_PROMPT).toContain('**/__tests__/**');
    });

    it('warns against the API Contracts / Data Contracts false-positive trap', () => {
      expect(COMPILER_SYSTEM_PROMPT).toMatch(/API Contracts|Data Contracts/);
    });

    it('teaches the classifier to preserve narrow test globs instead of blanket-replacing', () => {
      expect(COMPILER_SYSTEM_PROMPT).toMatch(/narrow|preserve|do not overwrite/i);
    });

    it('includes at least one fileGlobs example with a test-inclusive glob (not just exclusion)', () => {
      const inclusivePattern = /"fileGlobs":\s*\[[^\]]*"\*\*\/\*\.test\.\*"/;
      const inclusiveAltPattern = /"fileGlobs":\s*\[[^\]]*"\*\*\/\*\.spec\.\*"/;
      const hasInclusive =
        inclusivePattern.test(COMPILER_SYSTEM_PROMPT) ||
        inclusiveAltPattern.test(COMPILER_SYSTEM_PROMPT);
      expect(hasInclusive).toBe(true);
    });
  });

  describe('PIPELINE3_COMPILER_PROMPT', () => {
    it('declares the classifier section with the #1626 issue reference', () => {
      expect(PIPELINE3_COMPILER_PROMPT).toContain('Test-Contract Scope Classifier');
      expect(PIPELINE3_COMPILER_PROMPT).toContain('mmnto-ai/totem#1626');
    });

    it('names the testing tag as a positive classifier signal', () => {
      expect(PIPELINE3_COMPILER_PROMPT).toMatch(/`testing`\s+tag/);
    });

    it('enumerates the broad test-inclusive glob set so monorepo layouts are covered', () => {
      expect(PIPELINE3_COMPILER_PROMPT).toContain('**/*.test.*');
      expect(PIPELINE3_COMPILER_PROMPT).toContain('**/*.spec.*');
      expect(PIPELINE3_COMPILER_PROMPT).toContain('**/tests/**');
      expect(PIPELINE3_COMPILER_PROMPT).toContain('**/__tests__/**');
    });

    it('warns against the API Contracts / Data Contracts false-positive trap', () => {
      expect(PIPELINE3_COMPILER_PROMPT).toMatch(/API Contracts|Data Contracts/);
    });

    it('teaches the classifier to preserve narrow test globs instead of blanket-replacing', () => {
      expect(PIPELINE3_COMPILER_PROMPT).toMatch(/narrow|preserve|do not overwrite/i);
    });
  });
});

// ─── KIND_ALLOW_LIST ────────────────────────────────

describe('KIND_ALLOW_LIST', () => {
  it('is a non-empty readonly array of strings', () => {
    expect(Array.isArray(KIND_ALLOW_LIST)).toBe(true);
    expect(KIND_ALLOW_LIST.length).toBeGreaterThan(0);
    for (const entry of KIND_ALLOW_LIST) {
      expect(typeof entry).toBe('string');
      expect(entry.length).toBeGreaterThan(0);
    }
  });

  it('contains the kinds from the compound spike allow-list (findings.md G-3)', () => {
    // Lock the spike-derived minimum set so a future edit cannot silently
    // drop one of the empirically-validated kinds. Spike reference:
    // packages/core/spikes/compound-ast-grep/findings.md gap G-3.
    const spikeMinimum = [
      'for_statement',
      'while_statement',
      'try_statement',
      'catch_clause',
      'function_declaration',
      'class_declaration',
      'method_definition',
      'import_statement',
      'export_statement',
    ];
    for (const kind of spikeMinimum) {
      expect(KIND_ALLOW_LIST).toContain(kind);
    }
  });

  it('has no duplicate entries', () => {
    const seen = new Set(KIND_ALLOW_LIST);
    expect(seen.size).toBe(KIND_ALLOW_LIST.length);
  });
});
