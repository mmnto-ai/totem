/**
 * The issue-form ↔ label-canon coupling, and the `-WhatIf` dry run of
 * `scripts/sync-labels.ps1` (mmnto-ai/totem#2792).
 *
 * Two contracts are locked here, both DERIVED from the real script rather than
 * mirrored (Tenet 20 — the same discipline `parity-label-canon.test.ts` applies
 * to the canon itself):
 *
 *   1. Every `.github/ISSUE_TEMPLATE/*.yml` form parses and applies exactly its
 *      own `type: <basename>` label, a name the script defines. A space-less
 *      `type:bug` would leave the canon's type label missing on every issue the
 *      form creates (whether GitHub drops the unknown label or mints a stray
 *      one); here it fails the suite instead.
 *   2. Every form's `Tier` and `Scope` dropdowns offer exactly the canon's
 *      `tier-*` names and its `scope: ` names with the namespace stripped. Both
 *      option sets are computed from the parsed script — never hand-listed — so
 *      a new scope in the script is a failing test until the forms carry it.
 *      The scope derivation reads ONLY names starting with `scope: `, so the
 *      `disposition: ` namespace can never leak into the dropdown.
 *
 * The last two cases spawn `pwsh` against the real script. The first proves the
 * `-WhatIf` shadow prints every `gh` call and executes none (a stub `gh` sits on
 * PATH and must stay untouched); the second proves the shadow does NOT leak into
 * a normal run — the same stub, no `-WhatIf`, must receive the whole canon. Both
 * run against `-Repo example/stub`; neither can reach GitHub, because `gh` on the
 * child's PATH is a log-appending stub.
 *
 * Every case skips when the repo-root files are absent (a packaged install
 * carries neither the script nor `.github/`), and the spawning ones skip when
 * `pwsh` is not on PATH.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { parseLabelCanon } from '@mmnto/totem';

/** packages/cli/src/commands → the repo root. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'sync-labels.ps1');
const TEMPLATE_DIR = path.join(ROOT, '.github', 'ISSUE_TEMPLATE');
const CONFIG_PATH = path.join(TEMPLATE_DIR, 'config.yml');
const ONBOARDING_PATH = path.join(TEMPLATE_DIR, 'onboarding.md');

const REPO_FILES_PRESENT = fs.existsSync(SCRIPT_PATH) && fs.existsSync(TEMPLATE_DIR);

/** `pwsh` on PATH and runnable — absent on a minimal container, present on every GitHub runner. */
function pwshRunnable(): boolean {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
  return probe.error === undefined && probe.status === 0;
}
const PWSH_PRESENT = REPO_FILES_PRESENT && pwshRunnable();

// ─── Shapes (the subset of the GitHub issue-form schema this suite reads) ───

interface FormField {
  type?: string;
  id?: string;
  attributes?: {
    label?: string;
    multiple?: boolean;
    options?: string[];
    value?: string;
  };
  validations?: { required?: boolean };
}

interface IssueForm {
  name?: string;
  description?: string;
  labels?: string[];
  body?: FormField[];
}

/** The form files, `config.yml` excluded (it is not a form). */
function formFiles(): string[] {
  return fs
    .readdirSync(TEMPLATE_DIR)
    .filter((file) => file.endsWith('.yml') && file !== 'config.yml')
    .sort();
}

function readForm(file: string): IssueForm {
  return parseYaml(fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8')) as IssueForm;
}

/** The canon of record, parsed from the real script exactly as the sensor parses it. */
function realCanon() {
  return parseLabelCanon(fs.readFileSync(SCRIPT_PATH, 'utf8'));
}

/** The `tier-*` canonical names — the Tier dropdown's option set, derived. */
function tierOptionsFromCanon(names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith('tier-')).sort();
}

/**
 * The `scope: ` canonical names with the namespace stripped — the Scope
 * dropdown's option set, derived. The `scope: ` prefix is the ONLY source, so a
 * `disposition: ` (or any other namespace) entry can never enter this set.
 */
function scopeOptionsFromCanon(names: readonly string[]): string[] {
  const prefix = 'scope: ';
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

/** The one dropdown in `form.body` whose rendered label is `label`. */
function dropdownByLabel(form: IssueForm, label: string): FormField | undefined {
  return (form.body ?? []).find(
    (field) => field.type === 'dropdown' && field.attributes?.label === label,
  );
}

// ─── Forms ↔ canon ───────────────────────────────────────

describe.skipIf(!REPO_FILES_PRESENT)('issue forms', () => {
  it('ships one form per canonical type, each parsing as YAML with a name and a description', () => {
    const files = formFiles();
    expect(files).toEqual([
      'bug.yml',
      'chore.yml',
      'docs.yml',
      'epic.yml',
      'feature.yml',
      'security.yml',
    ]);
    for (const file of files) {
      const form = readForm(file);
      expect(typeof form.name, file).toBe('string');
      expect(typeof form.description, file).toBe('string');
      expect(Array.isArray(form.body), file).toBe(true);
      // Titles stay free-form — no `title:` prefix is imposed on the author.
      expect(Object.keys(form as Record<string, unknown>), file).not.toContain('title');
    }
  });

  it('applies exactly its own type: label, one the script defines (the space in `type: bug` is load-bearing)', () => {
    const canonNames = new Set(realCanon().labels.map((label) => label.name));
    // The canon must be non-empty, or this assertion would pass vacuously the
    // moment the script's grammar changed (the readers' own empty-canon refusal).
    expect(canonNames.size).toBeGreaterThan(0);
    for (const file of formFiles()) {
      const form = readForm(file);
      // Charter § 4c(ii): one template per `type:` value, applying THAT label —
      // derived from the filename, so `docs.yml` cannot ship `type: bug`, an
      // empty list, or two type labels and still pass.
      const expected = `type: ${file.replace(/\.yml$/, '')}`;
      expect(form.labels, file).toEqual([expected]);
      expect(canonNames.has(expected), `${file} applies ${expected}`).toBe(true);
    }
  });

  it("carries a required Tier dropdown whose options are the canon's tier-* names", () => {
    const expected = tierOptionsFromCanon(realCanon().labels.map((label) => label.name));
    expect(expected.length).toBeGreaterThan(0);
    for (const file of formFiles()) {
      const form = readForm(file);
      const tier = dropdownByLabel(form, 'Tier');
      expect(tier, `${file} has a Tier dropdown`).toBeDefined();
      // The id and the label are BOTH a contract with the rung-1 body sensor.
      expect(tier?.id, file).toBe('tier');
      expect(tier?.validations?.required, file).toBe(true);
      expect([...(tier?.attributes?.options ?? [])].sort(), file).toEqual(expected);
    }
  });

  it("carries a required multi-select Scope dropdown whose options are the canon's scope: names, namespace stripped", () => {
    const expected = scopeOptionsFromCanon(realCanon().labels.map((label) => label.name));
    expect(expected.length).toBeGreaterThan(0);
    // Derived from `scope: ` alone — never "every label that is not a tier".
    expect(expected.some((option) => option.includes('disposition'))).toBe(false);
    for (const file of formFiles()) {
      const form = readForm(file);
      const scope = dropdownByLabel(form, 'Scope');
      expect(scope, `${file} has a Scope dropdown`).toBeDefined();
      expect(scope?.id, file).toBe('scope');
      expect(scope?.attributes?.multiple, file).toBe(true);
      expect(scope?.validations?.required, file).toBe(true);
      expect([...(scope?.attributes?.options ?? [])].sort(), file).toEqual(expected);
    }
  });

  it('renders every field under a distinct heading (the body sensor keys on heading text, never on ids)', () => {
    // The epic form once carried a `Scope` textarea beside the `Scope` dropdown:
    // two `### Scope` headings in one rendered body, and a heading-keyed parser
    // cannot tell them apart. Labels are the contract; ids never render.
    for (const file of formFiles()) {
      const form = readForm(file);
      const labels = (form.body ?? [])
        .map((field) => field.attributes?.label)
        .filter((label): label is string => typeof label === 'string');
      expect(new Set(labels).size, `${file} field labels: ${labels.join(' | ')}`).toBe(
        labels.length,
      );
    }
  });

  it('routes an exploitable vulnerability out of the public security form', () => {
    const form = readForm('security.yml');
    const first = (form.body ?? [])[0];
    expect(first?.type).toBe('markdown');
    expect(first?.attributes?.value ?? '').toMatch(/advisor/i);
  });

  it('disables blank issues and leaves the onboarding template in place', () => {
    const config = parseYaml(fs.readFileSync(CONFIG_PATH, 'utf8')) as {
      blank_issues_enabled?: boolean;
    };
    expect(config.blank_issues_enabled).toBe(false);
    expect(fs.existsSync(ONBOARDING_PATH)).toBe(true);
    // Untouched by mmnto-ai/totem#2792: still the front-matter markdown template it was.
    expect(fs.readFileSync(ONBOARDING_PATH, 'utf8').startsWith('---')).toBe(true);
  });
});

// ─── The pwsh dry run ────────────────────────────────────

/**
 * A temp dir holding a `gh` stub that appends its whole argument line to a log
 * and exits 0. Prepended to the child's PATH, it satisfies the script's `gh`
 * presence check and its `gh auth status` preflight while making a real GitHub
 * call impossible.
 */
function makeGhStub(): { dir: string; logPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gh-stub-'));
  const logPath = path.join(dir, 'gh-calls.log');
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, 'gh.cmd'),
      ['@echo off', `>>"${logPath}" echo %*`, ''].join('\r\n'),
      'utf8',
    );
  } else {
    const stub = path.join(dir, 'gh');
    fs.writeFileSync(stub, ['#!/bin/sh', `printf '%s\\n' "$*" >> "${logPath}"`, ''].join('\n'), {
      encoding: 'utf8',
      mode: 0o755,
    });
    fs.chmodSync(stub, 0o755);
  }
  return { dir, logPath };
}

/** `process.env` with `dir` prepended to PATH, whatever case the platform spells it. */
function envWithPathPrefix(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  let currentPath = '';
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === 'PATH') {
      currentPath = value ?? '';
      continue;
    }
    env[key] = value;
  }
  env.PATH = dir + path.delimiter + currentPath;
  return env;
}

function runScript(args: string[], stubDir: string) {
  return spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT_PATH, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: envWithPathPrefix(stubDir),
  });
}

describe.skipIf(!PWSH_PRESENT)('scripts/sync-labels.ps1 dry run', () => {
  it('-WhatIf prints every gh call and executes none', () => {
    const stub = makeGhStub();
    try {
      const run = runScript(['-WhatIf', '-Repo', 'example/stub'], stub.dir);
      expect(run.error).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const stdout = run.stdout;
      expect(stdout).toContain('[WhatIf] gh label edit "disposition: done"');
      const labelLines = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('[WhatIf] gh label'));
      // One line per would-be call, derived from the canon rather than pinned:
      // an `edit` per canonical label, a `create` per disposition label, and a
      // `delete` per Merge-Label retirement.
      const canon = realCanon();
      const creates = canon.labels.filter((label) => label.name.startsWith('disposition: ')).length;
      expect(labelLines.length).toBe(canon.labels.length + creates + canon.merges.length);
      // The shadow replaces the executable, so the stub on PATH never ran: no
      // log file at all. This is the "-WhatIf touches nothing" invariant.
      expect(fs.existsSync(stub.logPath)).toBe(false);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });

  it('a normal run reaches gh for the whole canon — the -WhatIf shadow never leaks', () => {
    const stub = makeGhStub();
    try {
      const run = runScript(['-Repo', 'example/stub'], stub.dir);
      expect(run.error).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).not.toContain('[WhatIf]');
      expect(fs.existsSync(stub.logPath), 'the stub gh was invoked').toBe(true);
      const calls = fs
        .readFileSync(stub.logPath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      // The preflight ran (the unauthenticated silent no-op is now a hard stop).
      expect(calls.some((call) => call.startsWith('auth status'))).toBe(true);
      expect(calls.filter((call) => call.startsWith('label edit ')).length).toBeGreaterThanOrEqual(
        24,
      );
      const created = calls
        .map((call) => /^label create "?(disposition: [a-z-]+)"?/.exec(call)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort();
      const expectedCreated = realCanon()
        .labels.map((label) => label.name)
        .filter((name) => name.startsWith('disposition: '))
        .sort();
      expect(expectedCreated).toHaveLength(6);
      expect(created).toEqual(expectedCreated);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });
});
