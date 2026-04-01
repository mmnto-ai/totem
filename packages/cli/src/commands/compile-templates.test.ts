import { describe, expect, it } from 'vitest';

import { COMPILER_SYSTEM_PROMPT, PIPELINE3_COMPILER_PROMPT } from './compile-templates.js';

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
