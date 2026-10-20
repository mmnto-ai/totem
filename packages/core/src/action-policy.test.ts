import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTION_KINDS,
  ACTION_POLICY_FILE,
  ACTION_POLICY_OVERRIDE_ENV,
  ActionPolicyConfigSchema,
  actionPolicyEvaluator,
  parseActionPolicyPayload,
  readActionPolicyConfig,
} from './action-policy.js';
import { TotemConfigError, TotemError } from './errors.js';
import type { GateContext } from './gate-types.js';
import { cleanTmpDir } from './test-utils.js';
import { MATCHED_FRAGMENT_MAX } from './transport-shield.js';

// The action-policy gate event (mmnto-ai/totem#3106): a consumer-authored
// policy file classifies edits and shell commands into governed action kinds.

let tmpRoot: string;
let totemDir: string;

function writePolicy(content: unknown): void {
  fs.writeFileSync(
    path.join(totemDir, ACTION_POLICY_FILE),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

/** A fixture policy carrying all eight action kinds. */
const ALL_KINDS_POLICY = {
  version: 1,
  _note: 'test fixture',
  environments: [{ name: 'prod', branches: ['main', 'release/*'] }],
  rows: [
    {
      id: 'app-code',
      action_kind: 'code_edit',
      scope: { paths: ['src/app/**'] },
      disposition: 'display',
      reason: 'application code',
    },
    {
      id: 'secrets',
      action_kind: 'secret_read',
      scope: { paths: ['secrets/**'], commands: ['cat secrets/*'] },
      disposition: 'deny',
    },
    {
      id: 'migrations',
      action_kind: 'db_migration',
      scope: { paths: ['db/migrations/**'], commands: ['pnpm db:migrate:prod'] },
      disposition: 'deny',
      reason: 'migrations run through the release train',
    },
    {
      id: 'seed-data',
      action_kind: 'db_data_write',
      scope: { commands: ['pnpm db:seed'] },
      disposition: 'warn',
    },
    {
      id: 'deploy-config',
      action_kind: 'deploy_config_change',
      scope: { paths: ['deploy/*.yaml'] },
      disposition: 'warn',
    },
    {
      id: 'prod-deploy',
      action_kind: 'deploy_trigger',
      scope: { commands: ['git push'] },
      environment: 'prod',
      disposition: 'deny',
    },
    {
      id: 'cron',
      action_kind: 'scheduled_job_change',
      scope: { paths: ['cron/**'] },
      disposition: 'warn',
    },
    {
      id: 'reindex',
      action_kind: 'index_rebuild',
      scope: { commands: ['node scripts/* --rebuild'] },
      disposition: 'display',
    },
  ],
};

function check(payload: unknown, context?: GateContext) {
  return actionPolicyEvaluator(payload, totemDir, context);
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-action-policy-'));
  totemDir = path.join(tmpRoot, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

describe('ActionPolicyConfigSchema', () => {
  it('accepts a policy carrying all eight action kinds', () => {
    const result = ActionPolicyConfigSchema.safeParse(ALL_KINDS_POLICY);
    expect(result.success).toBe(true);
    const kinds = new Set(ALL_KINDS_POLICY.rows.map((r) => r.action_kind));
    expect([...kinds].sort()).toEqual([...ACTION_KINDS].sort());
  });

  it('defaults a row environment to any', () => {
    const result = ActionPolicyConfigSchema.parse(ALL_KINDS_POLICY);
    expect(result.rows[0]?.environment).toBe('any');
  });

  it('rejects a missing version', () => {
    const { version: _omitted, ...rest } = ALL_KINDS_POLICY;
    expect(ActionPolicyConfigSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a version other than 1', () => {
    expect(ActionPolicyConfigSchema.safeParse({ ...ALL_KINDS_POLICY, version: 2 }).success).toBe(
      false,
    );
  });

  it('rejects a row with an empty scope', () => {
    const bad = {
      version: 1,
      rows: [{ id: 'r', action_kind: 'code_edit', scope: { paths: [] }, disposition: 'warn' }],
    };
    expect(ActionPolicyConfigSchema.safeParse(bad).success).toBe(false);
    const none = { ...bad, rows: [{ ...bad.rows[0], scope: {} }] };
    expect(ActionPolicyConfigSchema.safeParse(none).success).toBe(false);
  });

  it('rejects a row naming an undeclared environment', () => {
    const bad = {
      version: 1,
      rows: [
        {
          id: 'r',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          environment: 'staging',
          disposition: 'deny',
        },
      ],
    };
    expect(ActionPolicyConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an environment named any, the reserved row value', () => {
    const bad = {
      version: 1,
      environments: [{ name: 'any', branches: ['main'] }],
      rows: [
        {
          id: 'r',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          environment: 'any',
          disposition: 'deny',
        },
      ],
    };
    const result = ActionPolicyConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['environments.0.name']);
  });

  it('rejects a duplicate row id', () => {
    const row = {
      id: 'dup',
      action_kind: 'code_edit',
      scope: { paths: ['a'] },
      disposition: 'warn',
    };
    expect(ActionPolicyConfigSchema.safeParse({ version: 1, rows: [row, row] }).success).toBe(
      false,
    );
  });
});

describe('readActionPolicyConfig', () => {
  it('returns null when the file is absent', () => {
    expect(readActionPolicyConfig(totemDir)).toBeNull();
  });

  it('throws TotemConfigError on malformed JSON', () => {
    writePolicy('{ not json');
    expect(() => readActionPolicyConfig(totemDir)).toThrow(TotemConfigError);
  });

  it('throws TotemConfigError on a schema failure, naming the zod path', () => {
    writePolicy({
      version: 1,
      rows: [{ id: 'r', action_kind: 'not_a_kind', scope: { paths: ['a'] }, disposition: 'warn' }],
    });
    let caught: unknown;
    try {
      readActionPolicyConfig(totemDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TotemConfigError);
    expect((caught as TotemConfigError).code).toBe('CONFIG_INVALID');
    const schemaIssue = ActionPolicyConfigSchema.safeParse({
      version: 1,
      rows: [{ id: 'r', action_kind: 'not_a_kind', scope: { paths: ['a'] }, disposition: 'warn' }],
    }).error?.issues[0];
    expect((caught as Error).message).toBe(
      `[Totem Error] Invalid action-policy.json: rows.0.action_kind: ${schemaIssue?.message}`,
    );
  });
});

describe('parseActionPolicyPayload', () => {
  it('accepts a path payload for Write and a command payload for Bash', () => {
    expect(parseActionPolicyPayload({ tool: 'Write', path: 'a.ts' })).toEqual({
      tool: 'Write',
      path: 'a.ts',
    });
    expect(
      parseActionPolicyPayload({ tool: 'Bash', command: 'ls', platform: 'linux' }),
    ).toMatchObject({ tool: 'Bash', command: 'ls', platform: 'linux' });
  });

  it.each([
    [{ tool: 'Read', path: 'a.ts' }],
    [{ tool: 'Write' }],
    [{ tool: 'Write', path: '' }],
    [{ tool: 'Edit', command: 'ls' }],
    [{ tool: 'Bash', path: 'a.ts' }],
    [{ tool: 'Bash', command: '   ' }],
    [{ tool: 'Bash', command: 'ls', path: 'a.ts' }],
    [null],
  ])('throws GATE_INVALID on %j, never default-allows', (payload) => {
    let caught: unknown;
    try {
      parseActionPolicyPayload(payload);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TotemError);
    expect((caught as TotemError).code).toBe('GATE_INVALID');
  });
});

describe('actionPolicyEvaluator: file presence', () => {
  it('allows with no-policy-file when the file is absent', () => {
    const v = check({ tool: 'Write', path: 'db/migrations/001.sql' });
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-policy-file');
    expect(v.provenance.matched).toBeNull();
    expect(v.provenance.source).toBe('.totem/action-policy.json');
  });

  it('throws TotemConfigError on a corrupt file, never a verdict', () => {
    writePolicy('{ nope');
    expect(() => check({ tool: 'Write', path: 'a.ts' })).toThrow(TotemConfigError);
  });
});

describe('actionPolicyEvaluator: path arm', () => {
  beforeEach(() => writePolicy(ALL_KINDS_POLICY));

  it('denies an edit to a governed path, citing the row (positive control)', () => {
    const v = check({ tool: 'Edit', path: 'db/migrations/001_init.sql' });
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('migrations');
    expect(v.provenance.matched).toBe('db/migrations/001_init.sql');
    expect(v.provenance.detail).toMatchObject({
      actionKind: 'db_migration',
      policyDisposition: 'deny',
      environment: 'any',
      currentEnvironments: null,
      scopeKind: 'path',
      alsoMatched: [],
    });
    expect(v.reason).toBe('db_migration (deny): migrations run through the release train');
  });

  it('allows an ungoverned path with no-policy-match (negative control)', () => {
    const v = check({ tool: 'Write', path: 'docs/readme.md' });
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-policy-match');
    expect(v.provenance.matched).toBeNull();
  });

  it('evaluates a display row through the warn arm', () => {
    const v = check({ tool: 'Write', path: 'src/app/main.ts' });
    expect(v.disposition).toBe('warn');
    expect(v.provenance.detail).toMatchObject({ policyDisposition: 'display' });
    expect(v.reason).toBe('code_edit (display): application code');
  });

  it('falls back to the row id in the reason when the row carries none', () => {
    const v = check({ tool: 'Write', path: 'secrets/api.key' });
    expect(v.reason).toBe('secret_read (deny): governed by row secrets');
  });

  it('matches a Windows-style absolute path under the root after normalization', () => {
    const abs = path.join(tmpRoot, 'db', 'migrations', '002.sql').split(path.sep).join('\\');
    const v = check({ tool: 'Write', path: abs });
    expect(v.disposition).toBe('deny');
    expect(v.provenance.matched).toBe('db/migrations/002.sql');
  });

  it('allows a path outside the root with outside-repo', () => {
    const outside = path.join(path.dirname(tmpRoot), 'elsewhere', 'db', 'migrations', 'x.sql');
    const v = check({ tool: 'Write', path: outside });
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('outside-repo');
    expect(v.provenance.matched).toBe(outside);
  });

  it('treats a relative path escaping the root as outside-repo', () => {
    const v = check({ tool: 'Write', path: '../db/migrations/x.sql' });
    expect(v.provenance.ref).toBe('outside-repo');
  });
});

describe('actionPolicyEvaluator: command arm', () => {
  beforeEach(() => writePolicy(ALL_KINDS_POLICY));

  it.each([
    'cd apps/x && pnpm db:migrate:prod --force',
    'echo start; pnpm db:migrate:prod',
    'true | pnpm db:migrate:prod',
  ])('matches a governed command after an operator: %s', (command) => {
    const v = check({ tool: 'Bash', command, platform: 'linux' });
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('migrations');
    expect(v.provenance.matched).toMatch(/^pnpm db:migrate:prod/);
    expect(v.provenance.detail).toMatchObject({ scopeKind: 'command' });
  });

  it('does not match a longer token against a shorter literal', () => {
    const v = check({ tool: 'Bash', command: 'pnpm db:migrate:prod-report', platform: 'linux' });
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-policy-match');
  });

  it('does not match a pattern mentioned as an argument rather than a statement prefix', () => {
    const v = check({ tool: 'Bash', command: 'echo pnpm db:migrate:prod', platform: 'linux' });
    expect(v.provenance.ref).toBe('no-policy-match');
  });

  it('matches a per-token wildcard', () => {
    const v = check({
      tool: 'PowerShell',
      command: 'node scripts/reindex.mjs --rebuild --all',
      platform: 'win32',
    });
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('reindex');
    expect(v.provenance.detail).toMatchObject({ policyDisposition: 'display' });
  });

  it('bounds the matched statement to the fragment maximum', () => {
    const long = `pnpm db:migrate:prod ${'x'.repeat(200)}`;
    const v = check({ tool: 'Bash', command: long, platform: 'linux' });
    expect(v.provenance.matched).toBe(long.slice(0, MATCHED_FRAGMENT_MAX));
  });
});

describe('actionPolicyEvaluator: several rows', () => {
  it('lets the most severe disposition win and lists the rest', () => {
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'a-display',
          action_kind: 'code_edit',
          scope: { paths: ['x/**'] },
          disposition: 'display',
        },
        {
          id: 'b-warn',
          action_kind: 'code_edit',
          scope: { paths: ['x/*.ts'] },
          disposition: 'warn',
        },
        {
          id: 'c-deny',
          action_kind: 'secret_read',
          scope: { paths: ['x/k.ts'] },
          disposition: 'deny',
        },
        { id: 'd-deny', action_kind: 'code_edit', scope: { paths: ['x/**'] }, disposition: 'deny' },
      ],
    });
    const v = check({ tool: 'Write', path: 'x/k.ts' });
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('c-deny'); // ties to file order
    expect(v.provenance.detail).toMatchObject({ alsoMatched: ['a-display', 'b-warn', 'd-deny'] });
  });
});

describe('actionPolicyEvaluator: environment', () => {
  beforeEach(() => writePolicy(ALL_KINDS_POLICY));

  it('matches a prod row only when the branch matches a declared prod glob', () => {
    const onProd = check(
      { tool: 'Bash', command: 'git push origin', platform: 'linux' },
      { gitBranchReader: () => 'release/2026.10' },
    );
    expect(onProd.disposition).toBe('deny');
    expect(onProd.provenance.ref).toBe('prod-deploy');
    expect(onProd.provenance.detail).toMatchObject({
      environment: 'prod',
      currentEnvironments: ['prod'],
    });

    const onFeature = check(
      { tool: 'Bash', command: 'git push origin', platform: 'linux' },
      { gitBranchReader: () => 'feat/x' },
    );
    expect(onFeature.disposition).toBe('allow');
    expect(onFeature.provenance.ref).toBe('no-policy-match');
  });

  it('never reads the branch when no matched row names an environment', () => {
    const reader = vi.fn(() => 'main');
    check({ tool: 'Write', path: 'db/migrations/1.sql' }, { gitBranchReader: reader });
    check({ tool: 'Write', path: 'docs/a.md' }, { gitBranchReader: reader });
    check(
      { tool: 'Bash', command: 'pnpm db:seed', platform: 'linux' },
      { gitBranchReader: reader },
    );
    expect(reader).toHaveBeenCalledTimes(0);
  });

  it('reads the branch against the config root', () => {
    const reader = vi.fn(() => 'main');
    check({ tool: 'Bash', command: 'git push', platform: 'linux' }, { gitBranchReader: reader });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith(path.dirname(path.resolve(totemDir)));
  });

  it('is unevaluable when the reader throws: deny under strict, warn under pilot', () => {
    const throwing = (): string => {
      throw new Error('git unavailable');
    };
    const payload = { tool: 'Bash', command: 'git push', platform: 'linux' };
    const strict = check(payload, { gitBranchReader: throwing });
    expect(strict.disposition).toBe('deny');
    expect(strict.provenance.ref).toBe('environment-unevaluable');

    const explicitStrict = check(payload, { tier: 'strict', gitBranchReader: throwing });
    expect(explicitStrict.disposition).toBe('deny');

    const pilot = check(payload, { tier: 'pilot', gitBranchReader: throwing });
    expect(pilot.disposition).toBe('warn');
    expect(pilot.provenance.ref).toBe('environment-unevaluable');
  });

  it('is unevaluable when the reader returns the getGitBranch failure sentinel', () => {
    const payload = { tool: 'Bash', command: 'git push', platform: 'linux' };
    const strict = check(payload, { gitBranchReader: () => '(unknown)' });
    expect(strict.disposition).toBe('deny');
    expect(strict.provenance.ref).toBe('environment-unevaluable');

    const pilot = check(payload, { tier: 'pilot', gitBranchReader: () => '(unknown)' });
    expect(pilot.disposition).toBe('warn');
    expect(pilot.provenance.ref).toBe('environment-unevaluable');
  });

  it('reports the derived environments beside the row environment, empty when none matched', () => {
    writePolicy({
      version: 1,
      environments: [{ name: 'prod', branches: ['main'] }],
      rows: [
        {
          id: 'prod-push',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          environment: 'prod',
          disposition: 'warn',
        },
        {
          id: 'any-push',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          disposition: 'display',
        },
      ],
    });
    const v = check(
      { tool: 'Bash', command: 'git push', platform: 'linux' },
      { gitBranchReader: () => 'feat/x' },
    );
    expect(v.provenance.ref).toBe('any-push');
    expect(v.provenance.detail).toMatchObject({ environment: 'any', currentEnvironments: [] });
  });

  it('is unevaluable when the reader returns an empty string', () => {
    const v = check(
      { tool: 'Bash', command: 'git push', platform: 'linux' },
      { tier: 'pilot', gitBranchReader: () => '' },
    );
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('environment-unevaluable');
  });

  it('keeps a deny won by an any row when the environment is unevaluable', () => {
    writePolicy({
      version: 1,
      environments: [{ name: 'prod', branches: ['main'] }],
      rows: [
        {
          id: 'prod-push',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          environment: 'prod',
          disposition: 'warn',
        },
        {
          id: 'any-push',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          disposition: 'deny',
        },
      ],
    });
    const v = check(
      { tool: 'Bash', command: 'git push', platform: 'linux' },
      {
        tier: 'pilot',
        gitBranchReader: () => {
          throw new Error('git unavailable');
        },
      },
    );
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('any-push');
  });
});

describe('actionPolicyEvaluator: side effects', () => {
  it('is side-effect-free: bytes and directory entries unchanged after a check', () => {
    writePolicy(ALL_KINDS_POLICY);
    const fp = path.join(totemDir, ACTION_POLICY_FILE);
    const before = fs.readFileSync(fp, 'utf-8');
    const entriesBefore = fs.readdirSync(totemDir).sort();
    const rootBefore = fs.readdirSync(tmpRoot).sort();

    check({ tool: 'Write', path: 'db/migrations/1.sql' });
    check(
      { tool: 'Bash', command: 'git push', platform: 'linux' },
      { gitBranchReader: () => 'main' },
    );

    expect(fs.readFileSync(fp, 'utf-8')).toBe(before);
    expect(fs.readdirSync(totemDir).sort()).toEqual(entriesBefore);
    expect(fs.readdirSync(tmpRoot).sort()).toEqual(rootBefore);
  });
});

describe('actionPolicyEvaluator: override', () => {
  beforeEach(() => writePolicy(ALL_KINDS_POLICY));

  function overridden(env: NodeJS.ProcessEnv, payload: unknown, extra: GateContext = {}) {
    const lines: string[] = [];
    const v = check(payload, { env, writeStderr: (l) => void lines.push(l), ...extra });
    return { v, lines };
  }

  it('lifts a deny whose winning row is named into a warn citing the row', () => {
    const { v, lines } = overridden(
      { [ACTION_POLICY_OVERRIDE_ENV]: 'migrations' },
      { tool: 'Write', path: 'db/migrations/1.sql' },
    );
    expect(v.disposition).toBe('warn');
    expect(v.reason).toBe(
      `${ACTION_POLICY_OVERRIDE_ENV} lifted row(s) migrations (db_migration, deny): migrations run through the release train; proceeding`,
    );
    expect(v.provenance.ref).toBe('migrations');
    expect(v.provenance.matched).toBe('db/migrations/1.sql');
    expect(v.provenance.detail).toMatchObject({
      overriddenBy: ACTION_POLICY_OVERRIDE_ENV,
      actionKind: 'db_migration',
      policyDisposition: 'deny',
    });
    expect(lines).toEqual([
      `[action-policy] OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing path "db/migrations/1.sql"; row(s) migrations would have denied.\n`,
    ]);
  });

  it('reads a comma-separated list with surrounding whitespace', () => {
    const { v, lines } = overridden(
      { [ACTION_POLICY_OVERRIDE_ENV]: ' secrets , migrations ' },
      { tool: 'Bash', command: 'pnpm db:migrate:prod', platform: 'linux' },
    );
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('migrations');
    expect(lines).toHaveLength(1);
  });

  it('leaves a deny whose row is not named unchanged, writing nothing', () => {
    const { v, lines } = overridden(
      { [ACTION_POLICY_OVERRIDE_ENV]: 'secrets' },
      { tool: 'Write', path: 'db/migrations/1.sql' },
    );
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('migrations');
    expect(v.provenance.detail).not.toHaveProperty('overriddenBy');
    expect(lines).toEqual([]);
  });

  it('never touches a warn, display or allow verdict, writing nothing', () => {
    const env = { [ACTION_POLICY_OVERRIDE_ENV]: 'seed-data,app-code,migrations' };
    const warn = overridden(env, { tool: 'Bash', command: 'pnpm db:seed', platform: 'linux' });
    expect(warn.v.disposition).toBe('warn');
    expect(warn.v.provenance.detail).not.toHaveProperty('overriddenBy');
    expect(warn.lines).toEqual([]);

    const display = overridden(env, { tool: 'Write', path: 'src/app/main.ts' });
    expect(display.v.disposition).toBe('warn');
    expect(display.v.provenance.detail).toMatchObject({ policyDisposition: 'display' });
    expect(display.v.provenance.detail).not.toHaveProperty('overriddenBy');
    expect(display.lines).toEqual([]);

    const allow = overridden(env, { tool: 'Write', path: 'docs/readme.md' });
    expect(allow.v.disposition).toBe('allow');
    expect(allow.v.provenance.ref).toBe('no-policy-match');
    expect(allow.lines).toEqual([]);
  });

  it('writes nothing when no override is set', () => {
    const { v, lines } = overridden({}, { tool: 'Write', path: 'db/migrations/1.sql' });
    expect(v.disposition).toBe('deny');
    expect(lines).toEqual([]);
  });

  it('reads the process env when the context carries none', () => {
    const lines: string[] = [];
    vi.stubEnv(ACTION_POLICY_OVERRIDE_ENV, 'migrations');
    try {
      const v = check(
        { tool: 'Write', path: 'db/migrations/1.sql' },
        { writeStderr: (l) => void lines.push(l) },
      );
      expect(v.disposition).toBe('warn');
      expect(lines).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ─── Fold of the pre-merge falsification read (mmnto-ai/totem#3106) ─────

const MIGRATE_DENY = {
  id: 'migrate',
  action_kind: 'db_migration',
  scope: { commands: ['pnpm db:migrate:prod'] },
  disposition: 'deny',
};

function bash(command: string) {
  return { tool: 'Bash', command, platform: 'linux' };
}

describe('override: every candidate deny row must be named', () => {
  const TWO_DENY = {
    version: 1,
    rows: [
      {
        id: 'deny-a',
        action_kind: 'db_migration',
        scope: { paths: ['db/**'] },
        disposition: 'deny',
      },
      {
        id: 'deny-b',
        action_kind: 'secret_read',
        scope: { paths: ['db/secrets/**'] },
        disposition: 'deny',
      },
    ],
  };

  function run(named: string) {
    const lines: string[] = [];
    const v = check(
      { tool: 'Write', path: 'db/secrets/k.sql' },
      { env: { [ACTION_POLICY_OVERRIDE_ENV]: named }, writeStderr: (l) => void lines.push(l) },
    );
    return { v, lines };
  }

  it('one of two deny rows named: deny citing the unnamed row, no overriddenBy, no stderr', () => {
    writePolicy(TWO_DENY);
    const { v, lines } = run('deny-a');
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('deny-b');
    expect(v.provenance.detail).not.toHaveProperty('overriddenBy');
    expect(lines).toEqual([]);
  });

  it('both deny rows named: a warn listing both, one stderr line naming both', () => {
    writePolicy(TWO_DENY);
    const { v, lines } = run('deny-b,deny-a');
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('deny-a');
    expect(v.reason).toBe(
      `${ACTION_POLICY_OVERRIDE_ENV} lifted row(s) deny-a, deny-b (db_migration, secret_read, deny): governed; proceeding`,
    );
    expect(v.provenance.detail).toMatchObject({
      overriddenBy: ACTION_POLICY_OVERRIDE_ENV,
      overriddenRows: ['deny-a', 'deny-b'],
    });
    expect(lines).toEqual([
      `[action-policy] OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing path "db/secrets/k.sql"; row(s) deny-a, deny-b would have denied.\n`,
    ]);
  });

  it('never applies when an environment deny row was skipped because the branch was unreadable', () => {
    writePolicy({
      version: 1,
      environments: [{ name: 'prod', branches: ['main'] }],
      rows: [
        {
          id: 'any-deny',
          action_kind: 'db_migration',
          scope: { paths: ['db/**'] },
          disposition: 'deny',
        },
        {
          id: 'prod-deny',
          action_kind: 'db_migration',
          scope: { paths: ['db/**'] },
          environment: 'prod',
          disposition: 'deny',
        },
      ],
    });
    const lines: string[] = [];
    const v = check(
      { tool: 'Write', path: 'db/1.sql' },
      {
        env: { [ACTION_POLICY_OVERRIDE_ENV]: 'any-deny,prod-deny' },
        writeStderr: (l) => void lines.push(l),
        gitBranchReader: () => '(unknown)',
      },
    );
    expect(v.disposition).toBe('deny');
    // The refusal cites the skipped deny row that refuses it.
    expect(v.provenance.ref).toBe('prod-deny');
    expect(v.reason).toBe(
      `${ACTION_POLICY_OVERRIDE_ENV} refused: row prod-deny (db_migration, deny) names environment "prod", which could not be read (git could not read the current branch); the override never applies while such a row is skipped.`,
    );
    expect(v.provenance.detail).toMatchObject({
      skippedForEnvironment: ['prod-deny'],
      overrideRefused: true,
    });
    expect(v.provenance.detail).not.toHaveProperty('overriddenBy');
    expect(lines).toEqual([]);
  });
});

describe('command matching from the program position', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['an assignment prefix', 'FOO=1 pnpm db:migrate:prod'],
    ['env with an assignment', 'env X=1 pnpm db:migrate:prod'],
    ['sudo', 'sudo pnpm db:migrate:prod'],
    ['time', 'time pnpm db:migrate:prod'],
    ['nohup', 'nohup pnpm db:migrate:prod'],
    ['xargs', 'echo | xargs pnpm db:migrate:prod'],
    ['a brace group', '{ pnpm db:migrate:prod; }'],
    ['an if condition', 'if pnpm db:migrate:prod; then echo ok; fi'],
    ['a negation', '! pnpm db:migrate:prod'],
    ['a $( ) substitution', 'out=$(pnpm db:migrate:prod)'],
    ['a backtick substitution', 'out=`pnpm db:migrate:prod`'],
    ['a nested substitution', 'echo "$(echo $(pnpm db:migrate:prod))"'],
  ])('reaches the program after %s', (_label, command) => {
    const v = check(bash(command));
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('migrate');
  });

  it('matches a program invoked by path against its basename', () => {
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'vercel-prod',
          action_kind: 'deploy_trigger',
          scope: { commands: ['vercel deploy --prod'] },
          disposition: 'deny',
        },
      ],
    });
    expect(check(bash('./node_modules/.bin/vercel deploy --prod')).provenance.ref).toBe(
      'vercel-prod',
    );
    expect(
      check({
        tool: 'PowerShell',
        command: "'C:\\tools\\VERCEL.CMD' deploy --prod",
        platform: 'win32',
      }).provenance.ref,
    ).toBe('vercel-prod');
    // A different program whose path merely contains the name is not it.
    expect(check(bash('./vercel-tools/run deploy --prod')).provenance.ref).toBe('no-policy-match');
  });
});

describe('opaque shell strings', () => {
  it.each([
    ['sh -c', 'sh -c "pnpm db:migrate:prod"'],
    ['bash -lc', "bash -lc 'echo hi'"],
    ['pwsh -Command', 'pwsh -Command "Get-Item x"'],
    ['powershell -c', 'powershell.exe -c "Get-Item x"'],
    ['cmd /c', 'cmd /c dir'],
    ['bash fed a heredoc', 'bash <<EOF\npnpm db:migrate:prod\nEOF'],
  ])('%s warns as opaque-shell-string when the policy has a command row', (_label, command) => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const v = check(bash(command));
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('opaque-shell-string');
  });

  it('carries the statement text, bounded, as matched', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const long = `sh -c "${'x'.repeat(200)}"`;
    expect(check(bash(long)).provenance.matched).toBe(long.slice(0, 80));
  });

  it('allows a shell string, unwarned, when the policy has no command row', () => {
    writePolicy({
      version: 1,
      rows: [
        { id: 'p', action_kind: 'code_edit', scope: { paths: ['src/**'] }, disposition: 'deny' },
      ],
    });
    const v = check(bash('sh -c "pnpm db:migrate:prod"'));
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-policy-match');
  });

  it('lets a deny row elsewhere in the command win over the opaque warn', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const v = check(bash('sh -c "echo x"; pnpm db:migrate:prod'));
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('migrate');
  });
});

describe('heredoc bodies are text', () => {
  it('allows a heredoc whose body carries a governed line', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const v = check(bash("cat > notes.md <<'X'\npnpm db:migrate:prod\nX"));
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-policy-match');
  });
});

describe('overlapping environments', () => {
  it('applies a prod row when staging and prod both match the branch', () => {
    writePolicy({
      version: 1,
      environments: [
        { name: 'staging', branches: ['release/*'] },
        { name: 'prod', branches: ['release/*', 'main'] },
      ],
      rows: [
        {
          id: 'prod-migrate',
          action_kind: 'db_migration',
          scope: { commands: ['pnpm db:migrate:prod'] },
          environment: 'prod',
          disposition: 'deny',
        },
      ],
    });
    const v = check(bash('pnpm db:migrate:prod'), { gitBranchReader: () => 'release/1' });
    expect(v.disposition).toBe('deny');
    expect(v.provenance.ref).toBe('prod-migrate');
    expect(v.provenance.detail).toMatchObject({ currentEnvironments: ['staging', 'prod'] });
  });
});

describe('the repository root as the path base', () => {
  it('governs an absolute edit under the git root with a nested totemDir', () => {
    fs.mkdirSync(path.join(tmpRoot, '.git'));
    const nested = path.join(tmpRoot, 'config', 'totem');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, ACTION_POLICY_FILE),
      JSON.stringify({
        version: 1,
        rows: [
          {
            id: 'migrations',
            action_kind: 'db_migration',
            scope: { paths: ['db/**'] },
            disposition: 'deny',
          },
        ],
      }),
    );
    const abs = path.join(tmpRoot, 'db', '001.sql');
    const v = actionPolicyEvaluator({ tool: 'Write', path: abs }, nested);
    expect(v.disposition).toBe('deny');
    expect(v.provenance.matched).toBe('db/001.sql');
    const rel = actionPolicyEvaluator({ tool: 'Write', path: 'db/001.sql' }, nested);
    expect(rel.disposition).toBe('deny');
  });
});

describe('strict, bounded schema', () => {
  const row = (extra: Record<string, unknown>) => ({
    version: 1,
    rows: [
      {
        id: 'r',
        action_kind: 'code_edit',
        scope: { paths: ['a/**'] },
        disposition: 'deny',
        ...extra,
      },
    ],
  });

  function loadError(content: unknown): string {
    writePolicy(content);
    try {
      readActionPolicyConfig(totemDir);
    } catch (err) {
      return (err as Error).message;
    }
    return '';
  }

  it('rejects the row typo "enviroment" with its path', () => {
    expect(loadError(row({ enviroment: 'prod' }))).toBe(
      "[Totem Error] Invalid action-policy.json: rows.0: Unrecognized key(s) in object: 'enviroment'",
    );
  });

  it('rejects the scope typo "command" with its path', () => {
    const bad = {
      version: 1,
      rows: [
        {
          id: 'r',
          action_kind: 'code_edit',
          scope: { paths: ['a/**'], command: ['x'] },
          disposition: 'deny',
        },
      ],
    };
    expect(loadError(bad)).toBe(
      "[Totem Error] Invalid action-policy.json: rows.0.scope: Unrecognized key(s) in object: 'command'",
    );
  });

  it.each(['/db/**', '\\db\\x', 'C:/db/**', 'c:db'])(
    'rejects the absolute path glob %s',
    (glob) => {
      const result = ActionPolicyConfigSchema.safeParse({
        version: 1,
        rows: [
          { id: 'r', action_kind: 'code_edit', scope: { paths: [glob] }, disposition: 'deny' },
        ],
      });
      expect(result.error?.issues.map((i) => i.message)).toEqual([
        'path globs are repo-relative: drop the leading "/", "\\" or drive letter (the gate makes every edited path relative to the repository root first)',
      ]);
    },
  );

  it('bounds path globs at three "*" and command tokens at two', () => {
    const parse = (scope: Record<string, unknown>) =>
      ActionPolicyConfigSchema.safeParse({
        version: 1,
        rows: [{ id: 'r', action_kind: 'code_edit', scope, disposition: 'deny' }],
      }).success;
    expect(parse({ paths: ['**/a/**/*.ts'] })).toBe(false);
    expect(parse({ paths: ['*a*a*a*b'] })).toBe(false);
    expect(parse({ paths: ['**/*.sql'] })).toBe(true);
    expect(parse({ paths: ['db/**/migrations/*.sql'] })).toBe(true);
    expect(parse({ commands: ['psql ***'] })).toBe(false);
    expect(parse({ commands: ['psql ** *x*'] })).toBe(true);
  });

  it('compares a long token against a wildcard quickly', () => {
    writePolicy({
      version: 1,
      rows: [
        { id: 'p', action_kind: 'code_edit', scope: { paths: ['*a*a*b'] }, disposition: 'deny' },
        {
          id: 'c',
          action_kind: 'code_edit',
          scope: { commands: ['run *a*b'] },
          disposition: 'deny',
        },
      ],
    });
    const started = Date.now();
    const p = check({ tool: 'Write', path: 'a'.repeat(1024) });
    const c = check(bash(`run ${'a'.repeat(1024)}`));
    // A generous bound on purpose: it separates a bounded match from an exponential
    // one, not fast hardware from slow. The bound compares a subject of up to 1024
    // characters against a wildcard, and this is that largest subject; the CI
    // runners took 2.1 s at about this size (a three-star glob backtracks cubically),
    // and a 1 s pin failed on all three of them (mmnto-ai/totem#3106).
    expect(Date.now() - started).toBeLessThan(5000);
    expect(p.provenance.ref).toBe('no-policy-match');
    expect(c.provenance.ref).toBe('no-policy-match');
  });

  it('compares a long literal token whole', () => {
    const literal = 'x'.repeat(1100);
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'c',
          action_kind: 'code_edit',
          scope: { commands: [`run ${literal}`] },
          disposition: 'deny',
        },
      ],
    });
    expect(check(bash(`run ${literal}`)).provenance.ref).toBe('c');
    expect(check(bash(`run ${literal}y`)).provenance.ref).toBe('no-policy-match');
  });
});

describe('an unreadable environment, capped at the skipped rows', () => {
  function policy(disposition: string) {
    return {
      version: 1,
      environments: [{ name: 'prod', branches: ['main'] }],
      rows: [
        {
          id: 'prod-row',
          action_kind: 'deploy_trigger',
          scope: { commands: ['git push'] },
          environment: 'prod',
          disposition,
        },
      ],
    };
  }
  const unreadable = { gitBranchReader: () => '' };

  it('a skipped display row yields warn at strict, listing the skipped row', () => {
    writePolicy(policy('display'));
    const v = check(bash('git push'), { tier: 'strict', ...unreadable });
    expect(v.disposition).toBe('warn');
    expect(v.provenance.ref).toBe('environment-unevaluable');
    expect(v.provenance.detail).toMatchObject({ skippedForEnvironment: ['prod-row'] });
  });

  it('a skipped deny row yields deny at strict and warn at pilot', () => {
    writePolicy(policy('deny'));
    expect(check(bash('git push'), { tier: 'strict', ...unreadable }).disposition).toBe('deny');
    expect(check(bash('git push'), { tier: 'pilot', ...unreadable }).disposition).toBe('warn');
  });
});

// The false-positive fixture: every (policy, input, expected) triple the
// classifier is held to, including the disclosed-limit shapes. Every match is
// an exact glob or token comparison against a declared row, so the budget is
// zero misclassifications by construction.
describe('false-positive fixture', () => {
  const POLICY = {
    version: 1,
    environments: [
      { name: 'prod', branches: ['main', 'release/*'] },
      { name: 'staging', branches: ['release/*'] },
    ],
    rows: [
      {
        id: 'migrations',
        action_kind: 'db_migration',
        scope: { paths: ['db/migrations/**'] },
        disposition: 'deny',
      },
      {
        id: 'prod-migrations',
        action_kind: 'db_migration',
        scope: { paths: ['db/migrations/**'] },
        environment: 'prod',
        disposition: 'deny',
      },
      MIGRATE_DENY,
      {
        id: 'force-migrate',
        action_kind: 'db_migration',
        scope: { commands: ['pnpm db:migrate:prod --force'] },
        disposition: 'deny',
      },
      {
        id: 'vercel-prod',
        action_kind: 'deploy_trigger',
        scope: { commands: ['vercel deploy --prod'] },
        environment: 'prod',
        disposition: 'deny',
      },
      {
        id: 'psql',
        action_kind: 'db_data_write',
        scope: { commands: ['psql **'] },
        disposition: 'warn',
      },
    ],
  };
  type Row = [string, Record<string, unknown>, string, string, GateContext?];
  const named = (ids: string, extra: GateContext = {}): GateContext => ({
    env: { [ACTION_POLICY_OVERRIDE_ENV]: ids },
    writeStderr: () => {},
    ...extra,
  });
  const ROWS: Row[] = [
    [
      'positive control: governed path',
      { tool: 'Edit', path: 'db/migrations/1.sql' },
      'deny',
      'migrations',
    ],
    [
      'negative control: ungoverned path',
      { tool: 'Edit', path: 'docs/a.md' },
      'allow',
      'no-policy-match',
    ],
    ['positive control: governed command', bash('pnpm db:migrate:prod'), 'deny', 'migrate'],
    [
      'negative control: longer token',
      bash('pnpm db:migrate:prod-report'),
      'allow',
      'no-policy-match',
    ],
    [
      'negative control: pattern as an argument',
      bash('echo pnpm db:migrate:prod'),
      'allow',
      'no-policy-match',
    ],
    ['fold: assignment prefix', bash('CI=1 pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: substitution body', bash('x=$(pnpm db:migrate:prod)'), 'deny', 'migrate'],
    ['fold: program by path', bash('./node_modules/.bin/pnpm db:migrate:prod'), 'deny', 'migrate'],
    [
      'fold: opaque shell string',
      bash('bash -c "pnpm db:migrate:prod"'),
      'warn',
      'opaque-shell-string',
    ],
    [
      'fold: shell on a heredoc',
      bash('sh <<EOF\npnpm db:migrate:prod\nEOF'),
      'warn',
      'opaque-shell-string',
    ],
    ['fold: ** crosses / in a token', bash('psql postgres://h/db'), 'warn', 'psql'],
    ['limit: a renamed program', bash('pn db:migrate:prod'), 'allow', 'no-policy-match'],
    ['limit: a script the agent wrote', bash('./scripts/migrate.sh'), 'allow', 'no-policy-match'],
    [
      'limit: a heredoc with a governed line as text',
      bash("cat > n.md <<'X'\npnpm db:migrate:prod\nX"),
      'allow',
      'no-policy-match',
    ],
    ['limit: case-sensitive identity', bash('PNPM db:migrate:prod'), 'allow', 'no-policy-match'],
    [
      'fold: override, one of two deny rows named',
      bash('pnpm db:migrate:prod --force'),
      'deny',
      'force-migrate',
      named('migrate'),
    ],
    [
      'fold: override, every deny row named',
      bash('pnpm db:migrate:prod --force'),
      'warn',
      'migrate',
      named('migrate,force-migrate'),
    ],
    [
      'fold: override refused by a skipped environment deny row',
      { tool: 'Edit', path: 'db/migrations/1.sql' },
      'deny',
      'prod-migrations',
      named('migrations,prod-migrations', { gitBranchReader: () => '' }),
    ],
    [
      'fold: the environment set (staging and prod both match)',
      bash('vercel deploy --prod'),
      'deny',
      'vercel-prod',
      { gitBranchReader: () => 'release/1' },
    ],
    [
      'fold: vercel-prod off its environment',
      bash('vercel deploy --prod'),
      'allow',
      'no-policy-match',
      { gitBranchReader: () => 'feat/x' },
    ],
    [
      'fold: an unreadable environment',
      bash('vercel deploy --prod'),
      'deny',
      'environment-unevaluable',
      { gitBranchReader: () => '' },
    ],
    ['fold: sudo -u root', bash('sudo -u root pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: sudo -E', bash('sudo -E pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: nice -n 5', bash('nice -n 5 pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: env -i', bash('env -i pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: xargs -n1', bash('echo a | xargs -n1 pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: /usr/bin/sudo', bash('/usr/bin/sudo pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: sudo --', bash('sudo -- pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: env FOO=1 --', bash('env FOO=1 -- pnpm db:migrate:prod'), 'deny', 'migrate'],
    ['fold: busybox sh -c', bash("busybox sh -c 'x'"), 'warn', 'opaque-shell-string'],
    ['fold: a backtick body', bash('x=`pnpm db:migrate:prod`'), 'deny', 'migrate'],
    ['fold: a .exe spelling', bash('pnpm.exe db:migrate:prod'), 'deny', 'migrate'],
    ['fold: a .cmd spelling', bash('PNPM.CMD db:migrate:prod'), 'deny', 'migrate'],
    [
      'fold: an unquoted heredoc substitution',
      bash('cat <<EOF\n$(pnpm db:migrate:prod)\nEOF'),
      'deny',
      'migrate',
    ],
    [
      'fold: timeout with its duration',
      bash('timeout 600 pnpm db:migrate:prod'),
      'deny',
      'migrate',
    ],
    [
      'fold: a subject too long for a wildcard row',
      { tool: 'Edit', path: `db/migrations/${'a'.repeat(1100)}.sql` },
      'deny',
      'subject-too-long',
    ],
  ];

  it.each(ROWS)('%s', (_label, payload, disposition, ref, context) => {
    writePolicy(POLICY);
    const v = check(payload, context ?? { gitBranchReader: () => 'main' });
    expect([v.disposition, v.provenance.ref]).toEqual([disposition, ref]);
  });
});

// ─── Fold round two (mmnto-ai/totem#3106) ───────────────────────────────

const FLY_DENY = {
  id: 'fly-deploy',
  action_kind: 'deploy_trigger',
  scope: { commands: ['fly deploy'] },
  disposition: 'deny',
};

function pwsh(command: string) {
  return { tool: 'PowerShell', command, platform: 'win32' };
}

describe('heredoc quoting', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [FLY_DENY] }));

  it('reads a $( ) inside an unquoted heredoc body as a statement', () => {
    const v = check(bash('cat <<EOF\nrelease: $(fly deploy)\nEOF'));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'fly-deploy']);
  });

  it('reads a backtick body inside an unquoted heredoc body', () => {
    const v = check(bash('cat <<EOF\nrelease: `fly deploy`\nEOF'));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'fly-deploy']);
  });

  it.each(["<<'EOF'", '<<"EOF"'])('a %s body is text throughout', (op) => {
    const v = check(bash(`cat ${op}\nrelease: $(fly deploy)\nEOF`));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it('a PowerShell here-string is not parsed as one: its $( ) reads as a double-quoted substitution', () => {
    const v = check(pwsh('$x = @"\nrelease: $(fly deploy)\n"@'));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'fly-deploy']);
  });
});

describe('wrappers with options', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it('skips an option the table does not list as a flag, so its value reads as the program (disclosed)', () => {
    // GNU xargs' --process-slot-var takes a value the table does not list.
    const v = check(bash('xargs --process-slot-var SLOT pnpm db:migrate:prod'));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it.each([
    ['timeout with its duration', 'timeout 600 pnpm db:migrate:prod'],
    ['timeout -s with its value and its duration', 'timeout -s KILL 5 pnpm db:migrate:prod'],
    ['sudo -R with its value', 'sudo -R /chroot pnpm db:migrate:prod'],
    ['sudo --login-class with its value', 'sudo --login-class staff pnpm db:migrate:prod'],
  ])('reaches the program past %s', (_label, command) => {
    expect(check(bash(command)).provenance.ref).toBe('migrate');
  });

  it('reads --opt=value as one token', () => {
    const v = check(bash('sudo --user=root pnpm db:migrate:prod'));
    expect(v.provenance.ref).toBe('migrate');
  });

  it('reads `name {` as a function header, so echo { … } reaches the next token (disclosed)', () => {
    const v = check(bash('echo { pnpm db:migrate:prod }'));
    expect(v.provenance.ref).toBe('migrate');
  });

  it('reads exec -a NAME as a value option', () => {
    const v = check(bash('exec -a migrator pnpm db:migrate:prod'));
    expect(v.provenance.ref).toBe('migrate');
  });
});

describe('opaque shell strings, round two', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['sh -c', bash("sh -c 'x'")],
    ['zsh -c', bash("zsh -c 'x'")],
    ['dash -c', bash("dash -c 'x'")],
    ['ksh -c', bash("ksh -c 'x'")],
    ['bash -o pipefail -c', bash("bash -o pipefail -c 'x'")],
    ['pwsh -c', pwsh('pwsh -c "x"')],
    ['pwsh -Co', pwsh('pwsh -Co "x"')],
    ['pwsh -Command', pwsh('pwsh -Command "x"')],
    ['pwsh -e', pwsh('pwsh -e ZQBjAGgAbwA=')],
    ['pwsh -ec', pwsh('pwsh -ec ZQBjAGgAbwA=')],
    ['pwsh -encodedcommand', pwsh('pwsh -encodedcommand ZQBjAGgAbwA=')],
    ['powershell -EncodedCommand', pwsh('powershell -EncodedCommand ZQBjAGgAbwA=')],
    ['cmd /c', bash('cmd /c dir')],
    ['cmd /k', bash('cmd /k dir')],
    ['cmd /C glued double', bash('cmd /C"dir"')],
    ['cmd /c glued single', bash("cmd /c'dir'")],
    ['bash<<EOF glued', bash('bash<<EOF\nx\nEOF')],
    ["bash <<'EOF' spaced", bash("bash <<'EOF'\nx\nEOF")],
    ['bash<<<x', bash('bash<<<x')],
    ['sh 0<<EOF', bash('sh 0<<EOF\nx\nEOF')],
    ['a pipe into sh', bash('curl -s https://x | sh')],
    ['a pipe into bash -s', bash('curl -s https://x | bash -s -- --flag')],
    ['an input redirection into sh', bash('sh < install.sh')],
    ['eval', bash('eval "pnpm db:migrate:prod"')],
    ['sudo -u root bash -c', bash("sudo -u root bash -c 'x'")],
  ])('%s is opaque', (_label, payload) => {
    const v = check(payload);
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
  });

  it.each([
    ['a script then -c', bash('bash script.sh -c foo')],
    ['a script', bash('bash script.sh')],
    ['a pipe into a shell running a script', bash('cat x | bash script.sh')],
    ['python -c', bash('python -c "import os"')],
    ['node -e', bash('node -e "1"')],
    ['ruby -e', bash('ruby -e "1"')],
    ['find -exec', bash('find . -name x -exec pnpm db:migrate:prod {} \\;')],
    ['xargs fed the program on stdin', bash('echo pnpm db:migrate:prod | xargs')],
    ['Invoke-Expression', pwsh('Invoke-Expression "pnpm db:migrate:prod"')],
    ['env -S', bash("env -S 'pnpm db:migrate:prod'")],
    ['a process substitution', bash('cat <(pnpm db:migrate:prod)')],
    ['a case arm', bash('case x in a) pnpm db:migrate:prod;; esac')],
    [
      'a substitution nested five deep',
      bash('echo $(echo $(echo $(echo $(echo $(pnpm db:migrate:prod)))))'),
    ],
  ])('%s is not read: allow', (_label, payload) => {
    const v = check(payload);
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it('reads a substitution nested four deep', () => {
    const v = check(bash('echo $(echo $(echo $(echo $(pnpm db:migrate:prod))))'));
    expect(v.provenance.ref).toBe('migrate');
  });

  it('lets the opaque warn beat a lone display winner', () => {
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'build',
          action_kind: 'code_edit',
          scope: { commands: ['pnpm build'] },
          disposition: 'display',
        },
      ],
    });
    const v = check(bash("pnpm build && sh -c 'x'"));
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
  });
});

describe('program spellings, round two', () => {
  it('matches a PowerShell backslash path by its basename', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const v = check(pwsh('C:\\tools\\pnpm db:migrate:prod'));
    expect(v.provenance.ref).toBe('migrate');
  });

  it.each([
    ['Bash', bash('./scripts/deploy.sh --prod')],
    ['PowerShell', pwsh('.\\scripts\\deploy.sh --prod')],
  ])('drops a leading ./ for a slash-bearing pattern (%s)', (_label, payload) => {
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'deploy-script',
          action_kind: 'deploy_trigger',
          scope: { commands: ['scripts/deploy.sh --prod'] },
          disposition: 'deny',
        },
      ],
    });
    expect(check(payload).provenance.ref).toBe('deploy-script');
  });

  it('reads no backtick body on PowerShell (its escape character)', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const v = check(pwsh('echo `pnpm db:migrate:prod`'));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });
});

describe('the override, round two', () => {
  it('writes its stderr line only when the returned verdict owes it', () => {
    writePolicy({
      version: 1,
      environments: [{ name: 'prod', branches: ['main'] }],
      rows: [
        MIGRATE_DENY,
        {
          id: 'prod-migrate',
          action_kind: 'db_migration',
          scope: { commands: ['pnpm db:migrate:prod'] },
          environment: 'prod',
          disposition: 'warn',
        },
      ],
    });
    const lines: string[] = [];
    const v = check(bash('pnpm db:migrate:prod'), {
      env: { [ACTION_POLICY_OVERRIDE_ENV]: 'migrate' },
      writeStderr: (l) => void lines.push(l),
      gitBranchReader: () => '',
    });
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'environment-unevaluable']);
    expect(lines).toEqual([]);
  });

  it('returns the override warn and lists a shell string elsewhere in the command', () => {
    writePolicy({ version: 1, rows: [MIGRATE_DENY] });
    const lines: string[] = [];
    const v = check(bash("pnpm db:migrate:prod && sh -c 'fly deploy'"), {
      env: { [ACTION_POLICY_OVERRIDE_ENV]: 'migrate' },
      writeStderr: (l) => void lines.push(l),
    });
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'migrate']);
    expect(v.provenance.detail).toMatchObject({
      overriddenRows: ['migrate'],
      opaqueStatements: ["sh -c 'fly deploy'"],
    });
    expect(lines).toHaveLength(1);
  });

  it('keeps every other matched row, warn and display included, in alsoMatched', () => {
    writePolicy({
      version: 1,
      rows: [
        MIGRATE_DENY,
        {
          id: 'migrate-warn',
          action_kind: 'db_migration',
          scope: { commands: ['pnpm db:migrate:*'] },
          disposition: 'warn',
        },
        {
          id: 'pnpm-display',
          action_kind: 'code_edit',
          scope: { commands: ['pnpm **'] },
          disposition: 'display',
        },
      ],
    });
    const v = check(bash('pnpm db:migrate:prod'), {
      env: { [ACTION_POLICY_OVERRIDE_ENV]: 'migrate' },
      writeStderr: () => {},
    });
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'migrate']);
    expect(v.provenance.detail).toMatchObject({ alsoMatched: ['migrate-warn', 'pnpm-display'] });
  });
});

describe('relative globs that can never match', () => {
  it.each(['../db/**', './db/**', '~/db/**', '.\\db\\x'])('rejects %s at load', (glob) => {
    const result = ActionPolicyConfigSchema.safeParse({
      version: 1,
      rows: [{ id: 'r', action_kind: 'code_edit', scope: { paths: [glob] }, disposition: 'deny' }],
    });
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'a path glob starting with "../", "./" or "~" can never match: the gate compares the path relative to the repository root, with no leading "./"',
    ]);
  });
});

// ─── Final fold (mmnto-ai/totem#3106) ───────────────────────────────────

describe('unquoted heredoc bodies have no quoting or comment rule', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['after an apostrophe', "cat <<EOF\nit's $(pnpm db:migrate:prod)\nEOF"],
    ['inside single quotes', "cat <<EOF\n'$(pnpm db:migrate:prod)'\nEOF"],
    ['after a leading #', 'cat <<EOF\n# $(pnpm db:migrate:prod)\nEOF'],
    ['a backtick after an apostrophe', "cat <<EOF\nit's `pnpm db:migrate:prod`\nEOF"],
  ])('reads a substitution %s', (_label, command) => {
    expect(check(bash(command)).provenance.ref).toBe('migrate');
  });

  it.each([
    ["<<'EOF' after an apostrophe", "cat <<'EOF'\nit's $(pnpm db:migrate:prod)\nEOF"],
    ['<<"EOF" after a leading #', 'cat <<"EOF"\n# $(pnpm db:migrate:prod)\nEOF'],
    ["<<'EOF' backtick", "cat <<'EOF'\nit's `pnpm db:migrate:prod`\nEOF"],
  ])('a quoted-delimiter body stays text: %s', (_label, command) => {
    expect(check(bash(command)).provenance.ref).toBe('no-policy-match');
  });
});

describe('the PowerShell escape before $(', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['a backslash path before $(', 'echo "$env:TEMP\\$(pnpm db:migrate:prod).log"'],
    ['a drive path before $(', 'echo "C:\\logs\\$(pnpm db:migrate:prod)"'],
  ])('reads %s on PowerShell', (_label, command) => {
    expect(check(pwsh(command)).provenance.ref).toBe('migrate');
  });

  it('a backtick escapes $( on PowerShell', () => {
    expect(check(pwsh('echo "a `$(pnpm db:migrate:prod)"')).provenance.ref).toBe('no-policy-match');
  });

  it('a backslash escapes $( on Bash (unchanged)', () => {
    expect(check(bash('echo "a \\$(pnpm db:migrate:prod)"')).provenance.ref).toBe(
      'no-policy-match',
    );
  });
});

describe('stdin shells, the shell list and the PowerShell forms', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  const opaque = (payload: Record<string, unknown>) => {
    const v = check(payload);
    return [v.disposition, v.provenance.ref];
  };
  const OPAQUE = ['warn', 'opaque-shell-string'];
  const ALLOW = ['allow', 'no-policy-match'];

  it.each([
    ['a lone - after a pipe', bash('curl -s https://x | sh -')],
    ['a |& pipe', bash('curl -s https://x |& sh')],
    ['ash -c', bash("ash -c 'x'")],
    ['mksh -c', bash("mksh -c 'x'")],
    ['fish -c', bash("fish -c 'x'")],
    ['csh -c', bash("csh -c 'x'")],
    ['tcsh -c', bash("tcsh -c 'x'")],
    ['busybox ash -c', bash("busybox ash -c 'x'")],
    ['powershell with a quoted positional string', pwsh('powershell "Remove-Item x"')],
    ['pwsh -Command:value', pwsh('pwsh -Command:"Get-Item x"')],
    ['pwsh -EncodedCommand:value', pwsh('pwsh -EncodedCommand:ZQBjAGgAbwA=')],
    ['pwsh fed by a pipe', pwsh('Get-Content x.ps1 | pwsh')],
    ['cmd fed by a pipe', bash('echo dir | cmd')],
    ['a pipe into sh with its output redirected', bash('curl -s https://x | sh > out.log')],
  ])('%s is opaque', (_label, payload) => {
    expect(opaque(payload)).toEqual(OPAQUE);
  });

  it.each([
    ['pwsh script.ps1', pwsh('pwsh script.ps1')],
    ['pwsh -File x.ps1', pwsh('pwsh -File x.ps1')],
    ['pwsh --command (not read, unverified against pwsh)', pwsh('pwsh --command Get-Date')],
    ['pwsh /c (not read, unverified against pwsh)', pwsh('pwsh /c Get-Date')],
  ])('%s is not opaque', (_label, payload) => {
    expect(opaque(payload)).toEqual(ALLOW);
  });

  it('a quoted string after an unread spelling is still caught as the quoted positional form', () => {
    expect(opaque(pwsh('pwsh --command "Get-Item x"'))).toEqual(OPAQUE);
  });
});

describe('leading redirections, coproc and subshells', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['>log', '>log pnpm db:migrate:prod'],
    ['2>&1', '2>&1 pnpm db:migrate:prod'],
    ['<in', '<in pnpm db:migrate:prod'],
    ['a bare > with its operand', '> log pnpm db:migrate:prod'],
    ['&>x', '&>x pnpm db:migrate:prod'],
    ['coproc', 'coproc pnpm db:migrate:prod'],
    ['a ( ) subshell', '(pnpm db:migrate:prod)'],
  ])('reaches the program after %s', (_label, command) => {
    expect(check(bash(command)).provenance.ref).toBe('migrate');
  });

  it.each([
    ['< install.sh sh', '< install.sh sh'],
    ['<<EOF bash', '<<EOF bash\npnpm db:migrate:prod\nEOF'],
  ])('a shell reached past %s is opaque', (_label, command) => {
    const v = check(bash(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
  });
});

describe('dead command patterns fail the load', () => {
  const parse = (pattern: string) =>
    ActionPolicyConfigSchema.safeParse({
      version: 1,
      rows: [
        {
          id: 'r',
          action_kind: 'deploy_trigger',
          scope: { commands: [pattern] },
          disposition: 'deny',
        },
      ],
    });

  it.each([
    'sudo reboot',
    'xargs rm',
    'env **',
    'time make',
    'nohup **',
    'coproc x',
    'if make',
    'timeout make',
    'CI=1 make',
    'function deploy',
  ])('refuses %s', (pattern) => {
    expect(parse(pattern).error?.issues.map((i) => i.message)).toEqual([
      'a command pattern starts at the program: drop the leading wrapper, reserved word, assignment, "function", "time" or "coproc" (the gate skips them before it compares, so this pattern could never match)',
    ]);
  });

  it('names a path-bearing wrapper basename as ungovernable, not as a prefix to drop', () => {
    expect(parse('./scripts/env deploy').error?.issues.map((i) => i.message)).toEqual([
      'a command pattern\'s first token "./scripts/env" has the basename of a wrapper the gate skips before the program, so it could never match: a repository script whose basename is a wrapper\'s cannot be governed by a command row',
    ]);
  });

  it('loads make', () => {
    expect(parse('make').success).toBe(true);
  });

  it('loads reboot', () => {
    expect(parse('reboot').success).toBe(true);
  });
});

// ─── Bot-round fold (mmnto-ai/totem#3106) ───────────────────────────────

describe('a subject too long for a wildcard is unevaluable, never a silent miss', () => {
  const PATH_POLICY = {
    version: 1,
    rows: [
      {
        id: 'sql',
        action_kind: 'db_migration',
        scope: { paths: ['**/*.sql'] },
        disposition: 'deny',
      },
    ],
  };
  const longPath = `${'d/'.repeat(549)}x.sql`; // 1103 characters

  it('a 1100-character path against **/*.sql: deny at strict, warn at pilot, ref subject-too-long', () => {
    writePolicy(PATH_POLICY);
    const strict = check({ tool: 'Write', path: longPath }, { tier: 'strict' });
    expect([strict.disposition, strict.provenance.ref]).toEqual(['deny', 'subject-too-long']);
    expect(strict.provenance.matched).toBe(longPath.slice(0, 80));
    expect(strict.provenance.detail).toMatchObject({ tooLongFor: ['sql'] });
    const pilot = check({ tool: 'Write', path: longPath }, { tier: 'pilot' });
    expect([pilot.disposition, pilot.provenance.ref]).toEqual(['warn', 'subject-too-long']);
  });

  it('a 1100-character command token against a wildcard token: deny at strict, warn at pilot', () => {
    writePolicy({
      version: 1,
      rows: [
        { id: 'c', action_kind: 'code_edit', scope: { commands: ['run *z'] }, disposition: 'deny' },
      ],
    });
    const command = `run ${'a'.repeat(1100)}z`;
    expect(check(bash(command), { tier: 'strict' }).provenance.ref).toBe('subject-too-long');
    expect(check(bash(command), { tier: 'strict' }).disposition).toBe('deny');
    expect(check(bash(command), { tier: 'pilot' }).disposition).toBe('warn');
  });

  it('a definite mismatch elsewhere in the pattern is no match, not unevaluable', () => {
    writePolicy({
      version: 1,
      rows: [
        { id: 'c', action_kind: 'code_edit', scope: { commands: ['run *z'] }, disposition: 'deny' },
      ],
    });
    expect(check(bash(`walk ${'a'.repeat(1100)}z`)).provenance.ref).toBe('no-policy-match');
  });

  it('a 1100-character literal path still compares whole', () => {
    const literal = `${'d/'.repeat(549)}x.sql`;
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'lit',
          action_kind: 'db_migration',
          scope: { paths: [literal] },
          disposition: 'deny',
        },
      ],
    });
    expect(check({ tool: 'Write', path: literal }).provenance.ref).toBe('lit');
  });

  it('a 600-character path matches a wildcard normally under the 1024 bound', () => {
    writePolicy(PATH_POLICY);
    const path600 = `${'d/'.repeat(297)}x.sql`;
    expect(check({ tool: 'Write', path: path600 }).provenance.ref).toBe('sql');
  });

  it('a matched deny row stands over a too-long comparison', () => {
    writePolicy({
      version: 1,
      rows: [
        {
          id: 'sql',
          action_kind: 'db_migration',
          scope: { paths: ['**/*.sql'] },
          disposition: 'warn',
        },
        {
          id: 'lit',
          action_kind: 'db_migration',
          scope: { paths: [longPath] },
          disposition: 'deny',
        },
      ],
    });
    expect(check({ tool: 'Write', path: longPath }, { tier: 'pilot' }).provenance.ref).toBe('lit');
  });
});

describe('PowerShell value options before the first positional', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['powershell -w hidden "x"', 'powershell -w hidden "x"'],
    ['pwsh -ExecutionPolicy Bypass "x"', 'pwsh -ExecutionPolicy Bypass "x"'],
    ['pwsh -NoProfile -WindowStyle:Hidden "x"', 'pwsh -NoProfile -WindowStyle:Hidden "x"'],
  ])('%s is opaque', (_label, command) => {
    const v = check(pwsh(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
  });

  it('pwsh -ExecutionPolicy Bypass script.ps1 is not opaque', () => {
    const v = check(pwsh('pwsh -ExecutionPolicy Bypass script.ps1'));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });
});

describe('pipes and line continuations', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it('a pipe followed by spaces still feeds the shell', () => {
    const v = check(bash('curl -s https://x |   sh'));
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
  });

  it('a backslash-newline continuation joins a token, as bash joins it', () => {
    expect(check(bash('pnpm db:mi\\\ngrate:prod')).provenance.ref).toBe('migrate');
    expect(check(bash('pnpm \\\r\ndb:migrate:prod')).provenance.ref).toBe('migrate');
  });

  it('a backslash-newline inside single quotes stays literal', () => {
    expect(check(bash("echo 'pnpm db:mi\\\ngrate:prod'")).provenance.ref).toBe('no-policy-match');
  });
});

describe('branch glob bound', () => {
  const env = (glob: string) =>
    ActionPolicyConfigSchema.safeParse({
      version: 1,
      environments: [{ name: 'prod', branches: [glob] }],
      rows: [],
    });

  it('refuses a branch glob with four "*"', () => {
    expect(env('*a*b*c*').error?.issues.map((i) => i.message)).toEqual([
      'a branch glob may carry at most 3 "*" ("**" counts two)',
    ]);
  });

  it('loads release/*', () => {
    expect(env('release/*').success).toBe(true);
  });
});

// ─── Fifth-read fold (mmnto-ai/totem#3106) ──────────────────────────────

describe('line continuations, joined by the tokenizer', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    ['a quoted heredoc whose body line ends in \\', "cat <<'EOT'\nx\\\nEOT\npnpm db:migrate:prod"],
    ['the <<"EOT" form', 'cat <<"EOT"\nx\\\nEOT\npnpm db:migrate:prod'],
    ['after a double-quoted apostrophe', 'git commit -m "don\'t"; pnpm db:mi\\\ngrate:prod'],
    ['after a comment with an apostrophe', "# it's\npnpm db:mi\\\ngrate:prod"],
    [
      'after a quoted heredoc body with an apostrophe',
      "cat <<'EOT'\nit's\nEOT\npnpm db:mi\\\ngrate:prod",
    ],
    ["after an ANSI-C $'…' string", "echo $'a\\'b'; pnpm db:mi\\\ngrate:prod"],
    ['an LF continuation', 'pnpm db:mi\\\ngrate:prod'],
    ['a CRLF continuation', 'pnpm \\\r\ndb:migrate:prod'],
  ])('reads the governed command %s', (_label, command) => {
    expect(check(bash(command)).provenance.ref).toBe('migrate');
  });

  it('a continuation inside single quotes stays literal', () => {
    expect(check(bash("echo 'x\\\ny'; echo 'pnpm db:mi\\\ngrate:prod'")).provenance.ref).toBe(
      'no-policy-match',
    );
  });

  it('a \\\\ before a newline is an escaped backslash, not a continuation', () => {
    expect(check(bash('pnpm db:mi\\\\\ngrate:prod')).provenance.ref).toBe('no-policy-match');
  });
});

describe('subject-too-long, capped and filtered', () => {
  const longDb = `db/${'d/'.repeat(549)}x.sql`; // over 1100 characters

  const policy = (rows: unknown[], environments?: unknown[]) =>
    writePolicy({ version: 1, ...(environments ? { environments } : {}), rows });

  it.each(['display', 'warn'])(
    'a %s row with a too-long subject yields warn at strict',
    (disposition) => {
      policy([{ id: 'r', action_kind: 'code_edit', scope: { paths: ['db/**'] }, disposition }]);
      const v = check({ tool: 'Write', path: longDb }, { tier: 'strict' });
      expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'subject-too-long']);
    },
  );

  it('a glob whose literal head cannot start the subject is a plain no-match', () => {
    policy([
      { id: 'r', action_kind: 'code_edit', scope: { paths: ['src/**'] }, disposition: 'deny' },
    ]);
    const v = check({ tool: 'Write', path: longDb });
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it('a prod-environment deny row on a feature branch is not considered', () => {
    policy(
      [
        {
          id: 'prod-sql',
          action_kind: 'db_migration',
          scope: { paths: ['**/*.sql'] },
          environment: 'prod',
          disposition: 'deny',
        },
      ],
      [{ name: 'prod', branches: ['main'] }],
    );
    const v = check({ tool: 'Write', path: longDb }, { gitBranchReader: () => 'feat/x' });
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it('an override naming the too-long deny row lifts it to the override warn', () => {
    policy([
      {
        id: 'sql',
        action_kind: 'db_migration',
        scope: { paths: ['**/*.sql'] },
        disposition: 'deny',
      },
    ]);
    const lines: string[] = [];
    const v = check(
      { tool: 'Write', path: longDb },
      { env: { [ACTION_POLICY_OVERRIDE_ENV]: 'sql' }, writeStderr: (l) => void lines.push(l) },
    );
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'sql']);
    expect(v.reason).toBe(
      `${ACTION_POLICY_OVERRIDE_ENV} lifted row(s) sql (db_migration, deny): governed; proceeding`,
    );
    expect(v.provenance.detail).toMatchObject({ overriddenRows: ['sql'], tooLongFor: ['sql'] });
    expect(lines).toHaveLength(1);
  });
});

describe('PowerShell value option prefixes', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([['pwsh -Exec Bypass "x"'], ['powershell -Window Hidden "x"'], ['pwsh -wd "a b" "x"']])(
    '%s is opaque',
    (command) => {
      const v = check(pwsh(command));
      expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'opaque-shell-string']);
    },
  );

  it('an option outside the set is a flag, so its value ends the search (documented)', () => {
    const v = check(pwsh('pwsh -Foo bar "x"'));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });
});

// ─── Sixth-read fold (mmnto-ai/totem#3106) ──────────────────────────────

describe('the pre-scan normaliser reaches substitutions and heredoc bodies', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [FLY_DENY, MIGRATE_DENY] }));

  it.each([
    ['a continuation inside $\\<LF>(', 'echo $\\\n(fly deploy)', 'fly-deploy'],
    ['the same inside double quotes', 'echo "$\\\n(fly deploy)"', 'fly-deploy'],
    ['the same in an unquoted heredoc body', 'cat <<EOT\n$\\\n(fly deploy)\nEOT', 'fly-deploy'],
    ['the same one level down', 'echo $(echo $\\\n(fly deploy))', 'fly-deploy'],
    ['a substitution after an ANSI-C string', "echo $'a\\'b' $(fly deploy)", 'fly-deploy'],
    ['a backtick after an ANSI-C string', "echo $'it\\'s' `fly deploy`", 'fly-deploy'],
    [
      'the quoted heredoc ending in \\ (fifth read)',
      "cat <<'EOT'\nx\\\nEOT\npnpm db:migrate:prod",
      'migrate',
    ],
    ['the <<"EOT" form (fifth read)', 'cat <<"EOT"\nx\\\nEOT\npnpm db:migrate:prod', 'migrate'],
  ])('%s → deny', (_label, command, ref) => {
    const v = check(bash(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', ref]);
  });

  it('the single-quoted split stays literal', () => {
    expect(check(bash("echo 'pnpm db:mi\\\ngrate:prod'")).provenance.ref).toBe('no-policy-match');
  });
});

describe('heredoc delimiters as bash reads them', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [FLY_DENY] }));

  it.each([
    ["<<E'O'T", "cat <<E'O'T\nx\nEOT\nfly deploy"],
    ['<<E\\OT', 'cat <<E\\OT\nx\nEOT\nfly deploy'],
    ['<<E"O"T', 'cat <<E"O"T\nx\nEOT\nfly deploy'],
    ["<<'E'OT", "cat <<'E'OT\nx\nEOT\nfly deploy"],
    ["<<$'EOT'", "cat <<$'EOT'\nx\nEOT\nfly deploy"],
    ['<<\\EOT', 'cat <<\\EOT\nx\nEOT\nfly deploy'],
    ['<<EO\\<LF>T', 'cat <<EO\\\nT\nx\nEOT\nfly deploy'],
  ])('%s ends at EOT, so the command after it is read', (_label, command) => {
    const v = check(bash(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'fly-deploy']);
    expect(v.provenance.matched).toBe('fly deploy');
  });

  it.each([
    ["<<E'O'T", "cat <<E'O'T\n$(fly deploy)\nEOT"],
    ['<<\\EOT', 'cat <<\\EOT\n$(fly deploy)\nEOT'],
  ])('a %s body is literal: its substitution is not read', (_label, command) => {
    const v = check(bash(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });

  it('a heredoc with no end line warns unterminated-heredoc', () => {
    const v = check(bash('cat <<EOF\nx\nfly deploy'));
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'unterminated-heredoc']);
    expect(v.provenance.matched).toBe('cat <<EOF');
  });

  it('a deny matched before an unterminated heredoc still stands', () => {
    const v = check(bash('fly deploy; cat <<EOF\nx'));
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'fly-deploy']);
    expect(v.provenance.detail).toMatchObject({ unterminatedHeredocs: ['fly deploy; cat <<EOF'] });
  });
});

describe('PowerShell -File prefixes', () => {
  beforeEach(() => writePolicy({ version: 1, rows: [MIGRATE_DENY] }));

  it.each([
    'pwsh -Fi x.ps1 "arg"',
    'pwsh -fil x.ps1 "arg"',
    'pwsh -File:x.ps1 "arg"',
    'pwsh -f x.ps1 "arg"',
  ])('%s is a script run, not opaque', (command) => {
    const v = check(pwsh(command));
    expect([v.disposition, v.provenance.ref]).toEqual(['allow', 'no-policy-match']);
  });
});

describe('the override and too-long deny rows', () => {
  const longSql = `db/${'d/'.repeat(549)}x.sql`;

  it('records every lifted row, a matched deny and a too-long deny', () => {
    writePolicy({
      version: 1,
      rows: [
        { id: 'db', action_kind: 'code_edit', scope: { paths: [longSql] }, disposition: 'deny' },
        {
          id: 'sql',
          action_kind: 'db_migration',
          scope: { paths: ['**/*.sql'] },
          disposition: 'deny',
        },
      ],
    });
    const lines: string[] = [];
    const v = check(
      { tool: 'Write', path: longSql },
      { env: { [ACTION_POLICY_OVERRIDE_ENV]: 'db,sql' }, writeStderr: (l) => void lines.push(l) },
    );
    expect([v.disposition, v.provenance.ref]).toEqual(['warn', 'db']);
    expect(v.provenance.detail).toMatchObject({ overriddenRows: ['db', 'sql'] });
    expect(lines).toEqual([
      `[action-policy] OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing path "${longSql}"; row(s) db, sql would have denied.\n`,
    ]);
  });

  const envPolicy = {
    version: 1,
    environments: [{ name: 'prod', branches: ['main'] }],
    rows: [
      {
        id: 'prod-sql',
        action_kind: 'db_migration',
        scope: { paths: ['**/*.sql'] },
        environment: 'prod',
        disposition: 'deny',
      },
    ],
  };

  it('a too-long environment deny row still counts under an unreadable branch', () => {
    writePolicy(envPolicy);
    const v = check({ tool: 'Write', path: longSql }, { gitBranchReader: () => '' });
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'subject-too-long']);
  });

  it('refuses the override for a too-long environment deny row under an unreadable branch', () => {
    writePolicy(envPolicy);
    const lines: string[] = [];
    const v = check(
      { tool: 'Write', path: longSql },
      {
        gitBranchReader: () => '',
        env: { [ACTION_POLICY_OVERRIDE_ENV]: 'prod-sql' },
        writeStderr: (l) => void lines.push(l),
      },
    );
    expect([v.disposition, v.provenance.ref]).toEqual(['deny', 'prod-sql']);
    expect(v.provenance.detail).toMatchObject({ overrideRefused: true });
    expect(lines).toEqual([]);
  });
});
