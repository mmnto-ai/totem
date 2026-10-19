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
      currentEnvironment: null,
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
      currentEnvironment: 'prod',
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

  it('reports the derived environment as currentEnvironment beside the row environment', () => {
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
    expect(v.provenance.detail).toMatchObject({ environment: 'any', currentEnvironment: 'any' });
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

  it('turns a deny whose winning row is named into allow, citing the row', () => {
    const { v, lines } = overridden(
      { [ACTION_POLICY_OVERRIDE_ENV]: 'migrations' },
      { tool: 'Write', path: 'db/migrations/1.sql' },
    );
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('migrations');
    expect(v.provenance.matched).toBe('db/migrations/1.sql');
    expect(v.provenance.detail).toMatchObject({
      overriddenBy: ACTION_POLICY_OVERRIDE_ENV,
      actionKind: 'db_migration',
      policyDisposition: 'deny',
    });
    expect(lines).toEqual([
      `[action-policy] OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing path "db/migrations/1.sql"; row migrations would have denied.\n`,
    ]);
  });

  it('reads a comma-separated list with surrounding whitespace', () => {
    const { v, lines } = overridden(
      { [ACTION_POLICY_OVERRIDE_ENV]: ' secrets , migrations ' },
      { tool: 'Bash', command: 'pnpm db:migrate:prod', platform: 'linux' },
    );
    expect(v.disposition).toBe('allow');
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
      expect(v.disposition).toBe('allow');
      expect(lines).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
