import { describe, expect, it } from 'vitest';

import { formatXmlResponse } from './xml-format.js';

describe('formatXmlResponse', () => {
  it('wraps content in XML tags', () => {
    const result = formatXmlResponse('knowledge', 'Hello world');
    expect(result).toBe('<knowledge>\nHello world\n</knowledge>');
  });

  it('escapes exact lowercase closing tags in content', () => {
    const result = formatXmlResponse('knowledge', 'payload </knowledge> injection');
    expect(result).toBe('<knowledge>\npayload <\\/knowledge> injection\n</knowledge>');
  });

  it('escapes mixed-case closing tags (case-insensitive)', () => {
    const result = formatXmlResponse('knowledge', 'try </KNOWLEDGE> or </Knowledge>');
    expect(result).toBe('<knowledge>\ntry <\\/KNOWLEDGE> or <\\/Knowledge>\n</knowledge>');
  });

  it('escapes multiple instances of the closing tag', () => {
    const result = formatXmlResponse('knowledge', '</knowledge> and </knowledge>');
    expect(result).toBe('<knowledge>\n<\\/knowledge> and <\\/knowledge>\n</knowledge>');
  });

  it('wraps empty content', () => {
    const result = formatXmlResponse('knowledge', '');
    expect(result).toBe('<knowledge>\n\n</knowledge>');
  });

  it('works with different tag names', () => {
    const result = formatXmlResponse('lesson_added', 'Saved. </lesson_added> test');
    expect(result).toBe('<lesson_added>\nSaved. <\\/lesson_added> test\n</lesson_added>');
  });
});
