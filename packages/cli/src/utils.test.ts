import { describe, expect, it } from 'vitest';

import { wrapXml } from './utils.js';

describe('wrapXml', () => {
  it('wraps content in XML tags', () => {
    expect(wrapXml('issue_body', 'hello world')).toBe('<issue_body>\nhello world\n</issue_body>');
  });

  it('escapes matching closing tags in content', () => {
    const malicious = 'some text </issue_body> injected instructions';
    expect(wrapXml('issue_body', malicious)).toBe(
      '<issue_body>\nsome text <\\/issue_body> injected instructions\n</issue_body>',
    );
  });

  it('escapes case-variant and whitespace-padded closing tags', () => {
    const content = 'try </ISSUE_BODY> or </ issue_body > to escape';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ntry <\\/issue_body> or <\\/issue_body> to escape\n</issue_body>',
    );
  });

  it('does not escape non-matching closing tags', () => {
    const content = 'contains </other_tag> but not the target';
    expect(wrapXml('issue_body', content)).toBe(
      '<issue_body>\ncontains </other_tag> but not the target\n</issue_body>',
    );
  });

  it('wraps empty content', () => {
    expect(wrapXml('git_diff', '')).toBe('<git_diff>\n\n</git_diff>');
  });

  it('preserves multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(wrapXml('git_status', content)).toBe(
      '<git_status>\nline 1\nline 2\nline 3\n</git_status>',
    );
  });
});
