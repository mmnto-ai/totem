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
 * The remaining cases spawn `pwsh` against the real script. The first proves the
 * `-WhatIf` shadow prints every `gh` call and executes none (a stub `gh` sits on
 * PATH and must stay untouched); the second proves the shadow does NOT leak into
 * a normal run — the same stub, no `-WhatIf`, must receive the whole canon; the
 * rest drive the stub's failure modes (a refused `label edit`, a refused
 * `issue edit`, a failed `issue list`) to pin the mutation tally and the gated
 * delete in `Merge-Label` (mmnto-ai/totem#2837). Every one runs against
 * `-Repo example/stub`; none can reach GitHub, because `gh` on the child's PATH
 * is a log-appending stub.
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
  // The stub logs every call and exits 0, with four opt-in modes read from the
  // child's environment:
  //   TOTEM_GH_STUB_ISSUES          — `issue list` answers with one issue, #7,
  //                                   so the merge phase has something to relabel
  //   TOTEM_GH_STUB_FAIL_ISSUE_LIST — `issue list` exits 1 (a failed READ)
  //   TOTEM_GH_STUB_FAIL_ISSUE_EDIT — `issue edit` exits 1 (a failed relabel —
  //                                   the totem-status incident, mmnto-ai/totem#2837)
  //   TOTEM_GH_STUB_FAIL            — `label edit` exits 1 — the failure path of
  //                                   the mutation tally (Greptile P1 on mmnto-ai/totem#2827)
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(dir, 'gh.cmd'),
      [
        '@echo off',
        `>>"${logPath}" echo %*`,
        'if "%TOTEM_GH_STUB_ISSUES%"=="" goto :after_issues',
        'echo %* | findstr /C:"issue list" >nul',
        'if %errorlevel%==0 echo 7',
        ':after_issues',
        'if "%TOTEM_GH_STUB_FAIL_ISSUE_LIST%"=="" goto :after_list_fail',
        'echo %* | findstr /C:"issue list" >nul',
        'if %errorlevel%==0 exit /b 1',
        ':after_list_fail',
        'if "%TOTEM_GH_STUB_FAIL_ISSUE_EDIT%"=="" goto :after_edit_fail',
        'echo %* | findstr /C:"issue edit" >nul',
        'if %errorlevel%==0 exit /b 1',
        ':after_edit_fail',
        'if "%TOTEM_GH_STUB_FAIL%"=="" exit /b 0',
        'echo %* | findstr /C:"label edit" >nul',
        'if %errorlevel%==0 exit /b 1',
        'exit /b 0',
        '',
      ].join('\r\n'),
      'utf8',
    );
  } else {
    const stub = path.join(dir, 'gh');
    fs.writeFileSync(
      stub,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> "${logPath}"`,
        'if [ -n "$TOTEM_GH_STUB_ISSUES" ]; then',
        '  case "$*" in *"issue list"*) echo 7 ;; esac',
        'fi',
        'if [ -n "$TOTEM_GH_STUB_FAIL_ISSUE_LIST" ]; then',
        '  case "$*" in *"issue list"*) exit 1 ;; esac',
        'fi',
        'if [ -n "$TOTEM_GH_STUB_FAIL_ISSUE_EDIT" ]; then',
        '  case "$*" in *"issue edit"*) exit 1 ;; esac',
        'fi',
        'if [ -n "$TOTEM_GH_STUB_FAIL" ]; then',
        '  case "$*" in *"label edit"*) exit 1 ;; esac',
        'fi',
        'exit 0',
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o755 },
    );
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

function runScript(args: string[], stubDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT_PATH, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...envWithPathPrefix(stubDir), ...extraEnv },
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
      // a `create` AND an `edit` per canonical label (mmnto-ai/totem#2837 — an
      // `edit`-only canonical exits the run on a repo that never carried it),
      // and a `delete` per Merge-Label retirement.
      const canon = realCanon();
      const creates = canon.labels.length;
      expect(labelLines.length).toBe(canon.labels.length + creates + canon.merges.length);
      // Every canonical's `create` line immediately precedes its `edit` line.
      // Keyed on the name alone: the shadow re-quotes only an argument carrying
      // whitespace, and a description's em-dash is transliterated by the child
      // console's code page, so the colour and description are the count's
      // business (above), not this adjacency's.
      const q = (text: string) => (/\s/.test(text) ? `"${text}"` : text);
      for (const label of canon.labels) {
        const createAt = labelLines.findIndex((line) =>
          line.startsWith(`[WhatIf] gh label create ${q(label.name)} --color `),
        );
        expect(createAt, `create line for ${label.name}`).toBeGreaterThanOrEqual(0);
        expect(labelLines[createAt + 1], `edit line follows create for ${label.name}`).toMatch(
          new RegExp(
            `^\\[WhatIf\\] gh label edit ${q(label.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --color `,
          ),
        );
      }
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
      // Every canonical label was edited, by name, exactly once — the set and
      // the count both derive from the real script (CodeRabbit on mmnto-ai/totem#2827).
      const edited = calls
        .map((call) => /^label edit "?(.+?)"? --color /.exec(call)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort();
      const expectedEdited = realCanon()
        .labels.map((label) => label.name)
        .sort();
      expect(edited).toEqual(expectedEdited);
      // ...and created, by name, exactly once — every namespace, not only the
      // dispositions (mmnto-ai/totem#2837).
      const created = calls
        .map((call) => /^label create "?(.+?)"? --color /.exec(call)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort();
      expect(created).toEqual(expectedEdited);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });

  it('a failed label edit fails the run — mutation errors never reach "sync complete"', () => {
    // Authenticated but without write access, or an API failure: the literal
    // lines suppress stderr by design, so only the exit CODE can carry the
    // failure. The stub exits 1 on every `label edit`; the tally must name each
    // canonical label and the script must exit non-zero (Greptile P1).
    const stub = makeGhStub();
    try {
      const run = runScript(['-Repo', 'example/stub'], stub.dir, { TOTEM_GH_STUB_FAIL: '1' });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).toContain('label mutation(s) failed');
      expect(run.stdout).not.toContain('sync complete');
      const tallied = run.stdout
        .split(/\r?\n/)
        .filter((line) => line.includes('[Error] gh label edit')).length;
      expect(tallied).toBe(realCanon().labels.length);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });

  /** The stub's call log, one trimmed line per `gh` invocation. */
  function loggedCalls(logPath: string): string[] {
    return fs
      .readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  it('a converged relabel retires the old label — every merge deletes once the issue carries the new name', () => {
    // The positive control for the gate below: the stub lists issue #7 under
    // every legacy label and accepts every `issue edit`, so every `Merge-Label`
    // relabels #7 and then deletes the legacy name.
    const stub = makeGhStub();
    try {
      const run = runScript(['-Repo', 'example/stub'], stub.dir, { TOTEM_GH_STUB_ISSUES: '1' });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stdout).toBe(0);
      expect(run.stdout).toContain('sync complete');
      const calls = loggedCalls(stub.logPath);
      const merges = realCanon().merges.length;
      expect(merges).toBeGreaterThan(0);
      expect(calls.filter((call) => /^issue edit 7 --add-label /.test(call))).toHaveLength(merges);
      expect(calls.filter((call) => call.startsWith('label delete '))).toHaveLength(merges);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });

  it('a failed relabel keeps the old label — the delete is gated on every issue carrying the new name', () => {
    // The totem-status incident (2026-09-08, mmnto-ai/totem#2837): every
    // `issue edit --add-label "type: bug"` had failed and the delete still ran,
    // so `bug` left its issues with no replacement. The stub lists issue #7
    // under every legacy label and refuses every `issue edit`: the script must
    // name each kept label, delete nothing, and exit non-zero.
    const stub = makeGhStub();
    try {
      const run = runScript(['-Repo', 'example/stub'], stub.dir, {
        TOTEM_GH_STUB_ISSUES: '1',
        TOTEM_GH_STUB_FAIL_ISSUE_EDIT: '1',
      });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).not.toContain('sync complete');
      const merges = realCanon().merges.length;
      const kept = run.stdout
        .split(/\r?\n/)
        .filter((line) => line.includes("[Error] keeping '")).length;
      expect(kept).toBe(merges);
      const calls = loggedCalls(stub.logPath);
      expect(calls.filter((call) => /^issue edit 7 --add-label /.test(call))).toHaveLength(merges);
      expect(calls.filter((call) => call.startsWith('label delete '))).toHaveLength(0);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });

  it('a failed issue list keeps the old label — a read failure is not an empty list', () => {
    // `gh issue list` exits 1 (auth, rate limit, network): the script must not
    // read that as "no issue carries the label" and delete it. Nothing is
    // relabelled, nothing is deleted, the read failure counts against
    // convergence, and the run exits non-zero.
    const stub = makeGhStub();
    try {
      const run = runScript(['-Repo', 'example/stub'], stub.dir, {
        TOTEM_GH_STUB_FAIL_ISSUE_LIST: '1',
      });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stdout).toBe(1);
      expect(run.stdout).not.toContain('sync complete');
      const merges = realCanon().merges.length;
      const kept = run.stdout
        .split(/\r?\n/)
        .filter((line) =>
          /\[Error\] gh issue list '.+' failed \(exit 1\) -- keeping '/.test(line),
        ).length;
      expect(kept).toBe(merges);
      const calls = loggedCalls(stub.logPath);
      expect(calls.filter((call) => call.startsWith('issue edit '))).toHaveLength(0);
      expect(calls.filter((call) => call.startsWith('label delete '))).toHaveLength(0);
    } finally {
      fs.rmSync(stub.dir, { recursive: true, force: true });
    }
  });
});
