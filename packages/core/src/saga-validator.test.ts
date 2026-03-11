import { describe, expect, it } from 'vitest';

import { validateDocUpdate } from './saga-validator.js';

// ─── Checkbox mutations ─────────────────────────────────

describe('checkbox mutation detection', () => {
  it('detects unchecking a completed item', () => {
    const original = '- [x] Implement feature A\n- [ ] Implement feature B\n';
    const updated = '- [ ] Implement feature A\n- [ ] Implement feature B\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe('checkbox_mutation');
    expect(violations[0]!.message).toContain('unchecked');
    expect(violations[0]!.message).toContain('Implement feature A');
  });

  it('detects checking an incomplete item', () => {
    const original = '- [ ] Pending task\n';
    const updated = '- [x] Pending task\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe('checkbox_mutation');
    expect(violations[0]!.message).toContain('checked');
  });

  it('matches checkboxes with minor formatting changes', () => {
    const original = '- [x] **#123 Epic:** Build the thing\n';
    const updated = '- [ ] **#123 Epic:** Build the thing\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe('checkbox_mutation');
  });

  it('allows new checkboxes without flagging', () => {
    const original = '- [x] Existing item\n';
    const updated = '- [x] Existing item\n- [ ] New item added by LLM\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(0);
  });

  it('allows removed checkboxes without flagging', () => {
    const original = '- [x] Item A\n- [ ] Item B\n';
    const updated = '- [x] Item A\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(0);
  });

  it('passes when no checkboxes exist', () => {
    const original = '# Simple doc\nNo checkboxes here.\n';
    const updated = '# Simple doc\nUpdated content.\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(0);
  });

  it('passes when checkboxes are unchanged', () => {
    const original = '- [x] Done\n- [ ] Not done\n';
    const updated = '- [x] Done\n- [ ] Not done\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(0);
  });

  it('detects multiple mutations', () => {
    const original = '- [x] Task A\n- [x] Task B\n- [ ] Task C\n';
    const updated = '- [ ] Task A\n- [ ] Task B\n- [x] Task C\n';

    const violations = validateDocUpdate(original, updated);
    const checkboxViolations = violations.filter((v) => v.type === 'checkbox_mutation');
    expect(checkboxViolations).toHaveLength(3);
  });

  it('handles asterisk-style checkboxes', () => {
    const original = '* [x] Asterisk checkbox\n';
    const updated = '* [ ] Asterisk checkbox\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe('checkbox_mutation');
  });

  it('matches checkboxes with markdown link changes', () => {
    const original = '- [x] Implement [feature A](http://example.com)\n';
    const updated = '- [ ] Implement [feature A](http://other.com/updated)\n';

    const violations = validateDocUpdate(original, updated);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe('checkbox_mutation');
  });
});

// ─── Sentinel corruption ────────────────────────────────

describe('sentinel corruption detection', () => {
  it('detects unclosed totem sentinel', () => {
    const original = '# Doc\nSome content <!-- totem-ignore -->\n';
    const updated = '# Doc\nSome content <!-- totem-ignore\n';

    const violations = validateDocUpdate(original, updated);
    const sentinelViolations = violations.filter((v) => v.type === 'sentinel_corruption');
    expect(sentinelViolations).toHaveLength(1);
    expect(sentinelViolations[0]!.line).toBe(2);
  });

  it('passes with properly closed sentinels', () => {
    const original = '<!-- totem-start -->\nContent\n<!-- totem-end -->\n';
    const updated = '<!-- totem-start -->\nUpdated\n<!-- totem-end -->\n';

    const violations = validateDocUpdate(original, updated);
    const sentinelViolations = violations.filter((v) => v.type === 'sentinel_corruption');
    expect(sentinelViolations).toHaveLength(0);
  });

  it('detects unclosed sentinel when mixed with closed on same line', () => {
    const original = '<!-- totem-start --> <!-- totem-ignore -->\n';
    const updated = '<!-- totem-start --> <!-- totem-ignore\n';

    const violations = validateDocUpdate(original, updated);
    const sentinelViolations = violations.filter((v) => v.type === 'sentinel_corruption');
    expect(sentinelViolations).toHaveLength(1);
  });

  it('passes with no sentinels', () => {
    const original = '# Doc\nContent\n';
    const updated = '# Doc\nUpdated\n';

    const violations = validateDocUpdate(original, updated);
    const sentinelViolations = violations.filter((v) => v.type === 'sentinel_corruption');
    expect(sentinelViolations).toHaveLength(0);
  });
});

// ─── Frontmatter deletion ───────────────────────────────

describe('frontmatter deletion detection', () => {
  it('detects deleted frontmatter', () => {
    const original = '---\ntitle: My Doc\nstatus: active\n---\n# Content\n';
    const updated = '# Content\nUpdated without frontmatter.\n';

    const violations = validateDocUpdate(original, updated);
    const fmViolations = violations.filter((v) => v.type === 'frontmatter_deleted');
    expect(fmViolations).toHaveLength(1);
  });

  it('passes when frontmatter is preserved', () => {
    const original = '---\ntitle: My Doc\n---\n# Content\n';
    const updated = '---\ntitle: My Doc\nstatus: updated\n---\n# Content\nNew stuff.\n';

    const violations = validateDocUpdate(original, updated);
    const fmViolations = violations.filter((v) => v.type === 'frontmatter_deleted');
    expect(fmViolations).toHaveLength(0);
  });

  it('passes when original has no frontmatter', () => {
    const original = '# No frontmatter\nContent\n';
    const updated = '# No frontmatter\nUpdated\n';

    const violations = validateDocUpdate(original, updated);
    const fmViolations = violations.filter((v) => v.type === 'frontmatter_deleted');
    expect(fmViolations).toHaveLength(0);
  });
});

// ─── Excessive deletion ─────────────────────────────────

describe('excessive deletion detection', () => {
  it('detects when updated is less than 50% of original', () => {
    const original = 'A'.repeat(1000);
    const updated = 'B'.repeat(400);

    const violations = validateDocUpdate(original, updated);
    const delViolations = violations.filter((v) => v.type === 'excessive_deletion');
    expect(delViolations).toHaveLength(1);
    expect(delViolations[0]!.message).toContain('40%');
  });

  it('passes when updated is close to original size', () => {
    const original = 'A'.repeat(1000);
    const updated = 'B'.repeat(800);

    const violations = validateDocUpdate(original, updated);
    const delViolations = violations.filter((v) => v.type === 'excessive_deletion');
    expect(delViolations).toHaveLength(0);
  });

  it('skips check for trivially small originals', () => {
    const original = 'tiny';
    const updated = 'x';

    const violations = validateDocUpdate(original, updated);
    const delViolations = violations.filter((v) => v.type === 'excessive_deletion');
    expect(delViolations).toHaveLength(0);
  });

  it('passes when updated is exactly at threshold', () => {
    const original = 'A'.repeat(1000);
    const updated = 'B'.repeat(500);

    const violations = validateDocUpdate(original, updated);
    const delViolations = violations.filter((v) => v.type === 'excessive_deletion');
    expect(delViolations).toHaveLength(0);
  });
});

// ─── Combined scenarios ─────────────────────────────────

describe('validateDocUpdate (combined)', () => {
  it('returns empty array for a clean update', () => {
    const original = '# Roadmap\n\n- [x] Phase 1\n- [ ] Phase 2\n\nSome content here.\n';
    const updated = '# Roadmap\n\n- [x] Phase 1\n- [ ] Phase 2\n\nUpdated content here.\n';

    expect(validateDocUpdate(original, updated)).toHaveLength(0);
  });

  it('catches multiple violation types simultaneously', () => {
    const original =
      '---\ntitle: Doc\n---\n# Heading\n- [x] Done task\nContent.\n<!-- totem-start -->\nBlock\n<!-- totem-end -->\n' +
      'Padding to pass length check. '.repeat(10);
    const updated = '# Heading\n- [ ] Done task\n<!-- totem-broken\n';

    const violations = validateDocUpdate(original, updated);
    const types = new Set(violations.map((v) => v.type));
    expect(types.has('checkbox_mutation')).toBe(true);
    expect(types.has('sentinel_corruption')).toBe(true);
    expect(types.has('frontmatter_deleted')).toBe(true);
    expect(types.has('excessive_deletion')).toBe(true);
  });
});
