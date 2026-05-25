import { describe, expect, it } from 'vitest';

import { formatIndexEnvelope, formatSystemWarning, formatXmlResponse } from './xml-format.js';

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

  it('escapes closing tags with internal whitespace', () => {
    const result = formatXmlResponse('knowledge', 'try </ knowledge> or </knowledge >');
    expect(result).toBe('<knowledge>\ntry <\\/ knowledge> or <\\/knowledge >\n</knowledge>');
  });
});

describe('formatSystemWarning', () => {
  it('wraps message in totem_system_warning tags', () => {
    const result = formatSystemWarning('Context is large.');
    expect(result).toBe('<totem_system_warning>\nContext is large.\n</totem_system_warning>');
  });

  it('escapes closing tags in warning content', () => {
    const result = formatSystemWarning('data </totem_system_warning> injection');
    expect(result).toContain('<\\/totem_system_warning>');
    expect(result.startsWith('<totem_system_warning>')).toBe(true);
    expect(result.endsWith('</totem_system_warning>')).toBe(true);
  });
});

describe('formatIndexEnvelope (mmnto-ai/totem#2029)', () => {
  it('emits a status="no-index" envelope when lastSyncAt is null', () => {
    expect(formatIndexEnvelope({ lastSyncAt: null, staleness: null })).toBe(
      '<index-meta status="no-index" />',
    );
  });

  it('emits populated attributes when lastSyncAt is set', () => {
    expect(
      formatIndexEnvelope({
        lastSyncAt: '2026-05-25T17:44:58.714Z',
        staleness: '3 hours ago',
      }),
    ).toBe('<index-meta lastSyncAt="2026-05-25T17:44:58.714Z" staleness="3 hours ago" />');
  });

  it('preserves STALE: prefix in the staleness attribute', () => {
    expect(
      formatIndexEnvelope({
        lastSyncAt: '2026-05-11T00:00:00.000Z',
        staleness: 'STALE: 14 days ago',
      }),
    ).toBe('<index-meta lastSyncAt="2026-05-11T00:00:00.000Z" staleness="STALE: 14 days ago" />');
  });

  it('escapes embedded double quotes in attribute values', () => {
    expect(
      formatIndexEnvelope({
        lastSyncAt: 'fake"value',
        staleness: 'still "quoted"',
      }),
    ).toBe('<index-meta lastSyncAt="fake&quot;value" staleness="still &quot;quoted&quot;" />');
  });

  it('escapes embedded less-than characters in attribute values', () => {
    expect(
      formatIndexEnvelope({
        lastSyncAt: '2026-05-25T17:44:58.714Z',
        staleness: '<unexpected>',
      }),
    ).toBe('<index-meta lastSyncAt="2026-05-25T17:44:58.714Z" staleness="&lt;unexpected>" />');
  });

  it('treats null staleness as an empty attribute', () => {
    expect(formatIndexEnvelope({ lastSyncAt: '2026-05-25T17:44:58.714Z', staleness: null })).toBe(
      '<index-meta lastSyncAt="2026-05-25T17:44:58.714Z" staleness="" />',
    );
  });
});
