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
