import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading ───────────

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
  };
});

// ─── Helpers ────────────────────────────────────────────

/** Strip ANSI escape codes for assertion matching. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // totem-context: ANSI regex — not untrusted input
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-exemption-'));
}

/** Scaffold a .totem directory with config, cache dir, and optional exemption files. */
function scaffold(
  cwd: string,
  opts?: {
    shared?: Record<string, unknown>;
    local?: Record<string, unknown>;
    ledgerEvents?: string[];
  },
) {
  const totemDir = path.join(cwd, '.totem');
  const cacheDir = path.join(totemDir, 'cache');
  const ledgerDir = path.join(totemDir, 'ledger');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};', 'utf-8');

  if (opts?.shared) {
    fs.writeFileSync(
      path.join(totemDir, 'exemptions.json'),
      JSON.stringify(opts.shared, null, 2),
      'utf-8',
    );
  }

  if (opts?.local) {
    fs.writeFileSync(
      path.join(cacheDir, 'exemption-local.json'),
      JSON.stringify(opts.local, null, 2),
      'utf-8',
    );
  }

  if (opts?.ledgerEvents) {
    fs.writeFileSync(
      path.join(ledgerDir, 'events.ndjson'),
      opts.ledgerEvents.join('\n') + '\n',
      'utf-8',
    );
  }

  return { totemDir, cacheDir, ledgerDir };
}

const SAMPLE_SHARED = {
  version: 1,
  exemptions: [
    {
      patternId: 'shield:abc123',
      label: 'console debug noise',
      reason: 'Auto-promoted after 3 false positives',
      promotedAt: '2026-03-01T00:00:00.000Z',
      promotedBy: 'auto',
      sampleMessages: ['console.debug is fine'],
    },
    {
      patternId: 'manual:unsafe-cast',
      label: 'unsafe-cast',
      reason: 'Known safe cast in serializer layer',
      promotedAt: '2026-03-10T00:00:00.000Z',
      promotedBy: 'manual',
      sampleMessages: [],
    },
  ],
};

const SAMPLE_LOCAL = {
  patterns: {
    'shield:def456': {
      count: 2,
      sources: ['shield'],
      lastSeenAt: '2026-03-15T00:00:00.000Z',
      sampleMessages: ['Unused variable detected'],
    },
    'shield:ghi789': {
      count: 1,
      sources: ['bot', 'shield'],
      lastSeenAt: '2026-03-20T00:00:00.000Z',
      sampleMessages: ['Naming convention mismatch'],
    },
  },
};

const SAMPLE_LEDGER_EVENTS = [
  JSON.stringify({
    timestamp: '2026-03-01T10:00:00.000Z',
    type: 'exemption',
    ruleId: 'exemption-promoted',
    file: '(shield)',
    justification: 'console debug noise',
    source: 'shield',
  }),
  JSON.stringify({
    timestamp: '2026-03-10T12:00:00.000Z',
    type: 'exemption',
    ruleId: 'exemption-manual',
    file: '(shield)',
    justification: '--suppress unsafe-cast',
    source: 'shield',
  }),
  JSON.stringify({
    timestamp: '2026-03-15T08:00:00.000Z',
    type: 'override',
    ruleId: 'shield-override',
    file: '(shield)',
    justification: 'deadline override',
    source: 'shield',
  }),
];

// ─── Tests ──────────────────────────────────────────────

describe('exemption list', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('displays shared and local exemptions correctly', async () => {
    scaffold(tmpDir, { shared: SAMPLE_SHARED, local: SAMPLE_LOCAL });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionListCommand } = await import('./exemption.js');
    await exemptionListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));

    // Shared exemptions
    expect(output).toContain('Shared exemptions');
    expect(output).toContain('console debug');
    expect(output).toContain('unsafe-cast');
    expect(output).toContain('auto');
    expect(output).toContain('manual');
    expect(output).toContain('2 shared exemption(s)');

    // Local exemptions
    expect(output).toContain('Local exemptions');
    expect(output).toContain('shield:def4');
    expect(output).toContain('2 local pattern(s)');
  });

  it('handles empty state', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionListCommand } = await import('./exemption.js');
    await exemptionListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No active exemptions.');
  });

  it('shows only shared when no local exists', async () => {
    scaffold(tmpDir, { shared: SAMPLE_SHARED });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionListCommand } = await import('./exemption.js');
    await exemptionListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Shared exemptions');
    expect(output).not.toContain('Local exemptions');
  });
});

describe('exemption add', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('creates an exemption entry with reason', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionAddCommand } = await import('./exemption.js');
    await exemptionAddCommand({ rule: 'test-pattern', reason: 'Known false positive in tests' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain("Exemption added for 'test-pattern'");

    // Verify the file was written
    const shared = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.totem', 'exemptions.json'), 'utf-8'),
    );
    expect(shared.exemptions).toHaveLength(1);
    expect(shared.exemptions[0].label).toBe('test-pattern');
    expect(shared.exemptions[0].reason).toBe('Known false positive in tests');
    expect(shared.exemptions[0].promotedBy).toBe('manual');

    // Verify ledger event was written
    const ledger = fs.readFileSync(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'), 'utf-8');
    expect(ledger).toContain('exemption-manual');
    expect(ledger).toContain('test-pattern');
  });

  it('errors when --rule is missing', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionAddCommand } = await import('./exemption.js');
    await exemptionAddCommand({ reason: 'some reason' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Missing required flag: --rule');
    expect(process.exitCode).toBe(1);

    // Reset exitCode for other tests
    process.exitCode = undefined;
  });

  it('errors when --reason is missing', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionAddCommand } = await import('./exemption.js');
    await exemptionAddCommand({ rule: 'test-pattern' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Missing required flag: --reason');
    expect(process.exitCode).toBe(1);

    // Reset exitCode for other tests
    process.exitCode = undefined;
  });
});

describe('exemption audit', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('shows report with exemption counts', async () => {
    scaffold(tmpDir, {
      shared: SAMPLE_SHARED,
      local: SAMPLE_LOCAL,
      ledgerEvents: SAMPLE_LEDGER_EVENTS,
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionAuditCommand } = await import('./exemption.js');
    await exemptionAuditCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));

    expect(output).toContain('Exemption Audit Report');
    expect(output).toContain('Total shared exemptions');
    expect(output).toContain('Total local patterns');
    expect(output).toContain('Auto-promoted:  1');
    expect(output).toContain('Manual:         1');

    // Promotion candidates
    expect(output).toContain('Promotion candidates');
    expect(output).toContain('shield:def456');
    expect(output).toContain('2/3 strikes');

    // Recent events
    expect(output).toContain('Recent exemption/override events');
    expect(output).toContain('exemption');
    expect(output).toContain('override');
  });

  it('handles empty state gracefully', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { exemptionAuditCommand } = await import('./exemption.js');
    await exemptionAuditCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Exemption Audit Report');
    expect(output).toContain('Total shared exemptions');
    expect(output).toContain('No exemption-related events');
  });
});
