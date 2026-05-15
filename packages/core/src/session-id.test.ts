import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so spyOn works in ESM — same pattern as test-utils.test.ts.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { mintSessionId, readSessionId, writeSessionId } from './session-id.js';
import { cleanTmpDir } from './test-utils.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-session-'));
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

describe('mintSessionId', () => {
  it('returns a v4 UUID string', () => {
    const id = mintSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns distinct values across calls', () => {
    const a = mintSessionId();
    const b = mintSessionId();
    expect(a).not.toBe(b);
  });
});

describe('writeSessionId', () => {
  it('creates ledger directory and persists the UUID', () => {
    const id = mintSessionId();
    writeSessionId(tmpDir, id);
    const persisted = fs.readFileSync(path.join(tmpDir, 'ledger', '.session-id'), 'utf-8');
    expect(persisted).toBe(id);
  });

  it('overwrites an existing session-id file', () => {
    writeSessionId(tmpDir, mintSessionId());
    const second = mintSessionId();
    writeSessionId(tmpDir, second);
    const persisted = fs.readFileSync(path.join(tmpDir, 'ledger', '.session-id'), 'utf-8');
    expect(persisted).toBe(second);
  });
});

describe('readSessionId', () => {
  it('returns undefined when the file does not exist', () => {
    expect(readSessionId(tmpDir)).toBeUndefined();
  });

  it('returns the persisted UUID', () => {
    const id = mintSessionId();
    writeSessionId(tmpDir, id);
    expect(readSessionId(tmpDir)).toBe(id);
  });

  it('returns undefined when the file contents are not a UUID', () => {
    const ledgerDir = path.join(tmpDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, '.session-id'), 'not-a-uuid', 'utf-8');
    expect(readSessionId(tmpDir)).toBeUndefined();
  });

  it('returns undefined when the file is older than the TTL', () => {
    const id = mintSessionId();
    writeSessionId(tmpDir, id);
    const filePath = path.join(tmpDir, 'ledger', '.session-id');
    // Backdate the file to 25 hours ago (1 hour past default TTL).
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(filePath, past, past);
    expect(readSessionId(tmpDir)).toBeUndefined();
  });

  it('honors a custom ttlHours argument', () => {
    const id = mintSessionId();
    writeSessionId(tmpDir, id);
    const filePath = path.join(tmpDir, 'ledger', '.session-id');
    // Backdate to 30 minutes ago.
    const past = new Date(Date.now() - 30 * 60 * 1000);
    fs.utimesSync(filePath, past, past);
    // Within 1h TTL: returns the UUID.
    expect(readSessionId(tmpDir, 1)).toBe(id);
    // Within 15-minute TTL: expired, returns undefined.
    expect(readSessionId(tmpDir, 0.25)).toBeUndefined();
  });

  it('trims trailing whitespace from the persisted UUID', () => {
    const ledgerDir = path.join(tmpDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const id = mintSessionId();
    fs.writeFileSync(path.join(ledgerDir, '.session-id'), id + '\n', 'utf-8');
    expect(readSessionId(tmpDir)).toBe(id);
  });

  it('rethrows on unexpected error classes (Tenet 4 Fail Loud)', () => {
    // Force statSync to throw a non-fs error class — simulates an unexpected
    // failure mode the writer should propagate rather than silently swallow.
    const spy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new TypeError('unexpected non-fs error');
    });
    try {
      expect(() => readSessionId(tmpDir)).toThrow(TypeError);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns undefined on EACCES (known fs failure class)', () => {
    const spy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    try {
      expect(readSessionId(tmpDir)).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('rethrows when caught value is not an object (defensive type guard)', () => {
    const spy = vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw 'string-thrown-not-an-error';
    });
    try {
      // String values have no `.code` property; with the defensive type guard
      // the function rethrows rather than crashing on property access.
      expect(() => readSessionId(tmpDir)).toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('writeSessionId fail-loud behavior', () => {
  it('rethrows on unexpected error classes (Tenet 4 Fail Loud)', () => {
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new TypeError('unexpected non-fs error');
    });
    try {
      expect(() => writeSessionId(tmpDir, mintSessionId())).toThrow(TypeError);
    } finally {
      spy.mockRestore();
    }
  });

  it('invokes onWarn and returns silently on EACCES (known fs failure class)', () => {
    const onWarn = vi.fn();
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    try {
      writeSessionId(tmpDir, mintSessionId(), onWarn);
      expect(onWarn).toHaveBeenCalledOnce();
      expect(onWarn.mock.calls[0]![0]).toContain('Session-ID write failed');
    } finally {
      spy.mockRestore();
    }
  });
});
