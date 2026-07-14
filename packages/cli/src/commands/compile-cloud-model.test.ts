import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────
//
// These tests exercise the cloud-compile model resolution: the model POSTed
// to the cloud worker is a live request parameter, so it must come from
// --model or `orchestrator.defaultModel` — absence fails loud BEFORE any
// token exec or network call, never silently substituting a vendor default
// (Tenet-16 corollary, mmnto-ai/totem-strategy#800 item 1).

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-cloud-'));
}

/** Build a valid `## Lesson —` markdown block that readAllLessons can parse. */
function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

function setupWorkspace(tmpDir: string, options: { defaultModel?: string }): void {
  // Full-tier config with a shell orchestrator so compileCommand enters the
  // compilation branch. The shell command never runs under --cloud; the only
  // knob under test is the presence of `defaultModel`.
  fs.writeFileSync(
    path.join(tmpDir, 'totem.config.ts'),
    [
      'export default {',
      '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
      '  totemDir: ".totem",',
      '  orchestrator: {',
      '    provider: "shell",',
      '    command: "echo should-never-run",',
      ...(options.defaultModel !== undefined
        ? [`    defaultModel: "${options.defaultModel}",`]
        : []),
      '  },',
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );

  const totemDir = path.join(tmpDir, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  // One fresh lesson (absent from compiled-rules.json) so the cloud branch
  // has a non-manual lesson to send.
  fs.writeFileSync(
    path.join(lessonsDir, 'use-err.md'),
    lessonMarkdown('Use err in catch', 'Do not use the identifier "error" in catch blocks.'),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify({ version: 1, rules: [], nonCompilable: [] }, null, 2) + '\n',
    'utf-8',
  );
}

describe('compileCommand --cloud model resolution', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    // Short-circuit the Cloud Run token resolution: without this, the run
    // spawns `gcloud` with cwd inside tmpDir, whose child process can hold
    // the directory handle past afterEach on Windows (EPERM on rmSync).
    vi.stubEnv('TOTEM_CLOUD_TOKEN', 'test-token');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('fails loud before any network call when neither --model nor defaultModel is set', async () => {
    setupWorkspace(tmpDir, {});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(compileCommand({ cloud: 'http://127.0.0.1:9/compile' })).rejects.toThrow(
      /No model specified for cloud compile/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the configured defaultModel as the request model — never a hardcoded vendor fallback', async () => {
    setupWorkspace(tmpDir, { defaultModel: 'cfg-cloud-model' });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        stats: { elapsed_seconds: 0, succeeded: 0, failed: 0 },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Post-fetch result processing is not under test — the lesson has no
    // matching result row, so the run may complete or reject; either way the
    // request body already carries the assertion target.
    await compileCommand({ cloud: 'http://127.0.0.1:9/compile' }).catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body) as {
      model: string;
    };
    expect(body.model).toBe('cfg-cloud-model');
  });
});
