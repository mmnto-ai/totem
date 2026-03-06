import { describe, expect, it } from 'vitest';

import { wrapXml } from './xml-format.js';

describe('wrapXml', () => {
  it('wraps content in XML tags', () => {
    expect(wrapXml('knowledge', 'Hello world')).toBe('<knowledge>\nHello world\n</knowledge>');
  });

  it('escapes exact lowercase closing tags in content', () => {
    const result = wrapXml('knowledge', 'payload </knowledge> injection');
    expect(result).toBe('<knowledge>\npayload <\\/knowledge> injection\n</knowledge>');
  });

  it('escapes mixed-case closing tags (case-insensitive)', () => {
    const result = wrapXml('knowledge', 'try </KNOWLEDGE> or </Knowledge>');
    expect(result).toBe('<knowledge>\ntry <\\/KNOWLEDGE> or <\\/Knowledge>\n</knowledge>');
  });

  it('escapes multiple instances of the closing tag', () => {
    const result = wrapXml('knowledge', '</knowledge> and </knowledge>');
    expect(result).toBe('<knowledge>\n<\\/knowledge> and <\\/knowledge>\n</knowledge>');
  });

  it('wraps empty content', () => {
    expect(wrapXml('git_diff', '')).toBe('<git_diff>\n\n</git_diff>');
  });

  it('works with different tag names', () => {
    const result = wrapXml('lesson_added', 'Saved. </lesson_added> test');
    expect(result).toBe('<lesson_added>\nSaved. <\\/lesson_added> test\n</lesson_added>');
  });

  it('escapes closing tags with internal whitespace', () => {
    const result = wrapXml('knowledge', 'try </ knowledge> or </knowledge >');
    expect(result).toBe('<knowledge>\ntry <\\/ knowledge> or <\\/knowledge >\n</knowledge>');
  });

  it('does not escape non-matching closing tags', () => {
    const content = 'contains </other_tag> but not the target';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ncontains </other_tag> but not the target\n</issue_body>',
    );
  });

  it('preserves multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(wrapXml('git_status', content)).toBe(
      '<git_status>\nline 1\nline 2\nline 3\n</git_status>',
    );
  });
});
