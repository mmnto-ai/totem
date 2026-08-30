/**
 * `totemDir` rendering across the managed git-hook family (mmnto-ai/totem#2692).
 *
 * Two things are pinned here:
 *
 *  1. **Byte-identity at the default (C3).** Rendering at
 *     `{ tier: 'standard', totemDir: '.totem', fallbackCmd: 'pnpm dlx @mmnto/cli' }`
 *     must produce EXACTLY today's `tools/{pre-commit,pre-push,post-merge}`. This
 *     is what makes the slice non-breaking: no consumer's installed hooks drift
 *     on upgrade, and `tools/` never has to be regenerated. (The dedicated
 *     `tools-hook-parity.test.ts` binds the same three files; this file states
 *     the property as the FLOOR the custom-dir assertions are measured against.)
 *
 *  2. **Nothing is left hardcoded (C1/C4).** Under a custom `totemDir` no hook
 *     body may carry a `.totem` literal anywhere — not in the reader, not in a
 *     `[ -f ]` guard, not in a `grep` pattern, not in a comment — and the value
 *     must land through the right quoting regime per site.
 *
 * The resolver (`resolveHookRenderOptions`) is exercised against real config
 * files in a temp dir, since it is the ONE seam every writer goes through.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  assertRenderableTotemDir,
  buildHookContent,
  buildPostCheckoutHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  DEFAULT_TOTEM_DIR,
  getFallbackCommand,
  type HookRenderOptions,
  resolveHookRenderOptions,
} from './install-hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const DEFAULT_RENDER: HookRenderOptions = {
  tier: 'standard',
  totemDir: DEFAULT_TOTEM_DIR,
  fallbackCmd: 'pnpm dlx @mmnto/cli',
};

/** Every hook body, rendered at one set of options. */
function renderAll(render: HookRenderOptions): { name: string; body: string }[] {
  return [
    { name: 'pre-commit', body: buildPreCommitHook(render) },
    { name: 'pre-push', body: buildPrePushHook(render) },
    { name: 'post-merge', body: buildHookContent(render) },
    { name: 'post-checkout', body: buildPostCheckoutHookContent(render) },
  ];
}

// ─── C3: byte-identity at the default ────────────────────

describe('default render is byte-identical to the shipped tools/ hooks (C3)', () => {
  it.each([
    ['pre-commit', () => buildPreCommitHook(DEFAULT_RENDER)],
    ['pre-push', () => buildPrePushHook(DEFAULT_RENDER)],
    ['post-merge', () => buildHookContent(DEFAULT_RENDER)],
  ])('tools/%s', (file, render) => {
    // The repo pins no totemDir and no tier, and resolves the pnpm fallback —
    // exactly DEFAULT_RENDER (guarded below so a lockfile change is loud).
    expect(getFallbackCommand(REPO_ROOT)).toBe(DEFAULT_RENDER.fallbackCmd);
    expect(fs.readFileSync(path.join(REPO_ROOT, 'tools', file), 'utf-8')).toBe(render());
  });

  it('the strict arm is byte-stable at the default too (tools/ ships standard)', () => {
    const strict = buildPreCommitHook({ ...DEFAULT_RENDER, tier: 'strict' });
    const standard = buildPreCommitHook(DEFAULT_RENDER);
    // Only the tier assignment differs; the rendered reader path is the same.
    expect(strict).toContain('TOTEM_HOOK_TIER="strict"');
    expect(standard).toContain('TOTEM_HOOK_TIER="standard"');
    expect(strict.replace('TOTEM_HOOK_TIER="strict"', 'TOTEM_HOOK_TIER="standard"')).toBe(standard);
  });
});

// ─── C1/C4: a custom totemDir reaches every site ─────────

describe('a custom totemDir is rendered into every hook site (C1/C4)', () => {
  const CUSTOM = 'knowledge';
  const render: HookRenderOptions = { ...DEFAULT_RENDER, totemDir: CUSTOM };

  it('leaves NO `.totem` literal in any hook body', () => {
    for (const { name, body } of renderAll(render)) {
      expect(body, `${name} still carries a hardcoded .totem`).not.toContain('.totem');
    }
  });

  it('pre-commit reads the run store as a JSON literal at the configured dir', () => {
    const hook = buildPreCommitHook({ ...render, tier: 'strict' });
    // JSON.stringify is the quoting regime for the JS string inside the
    // single-quoted `node -e '…'` reader.
    expect(hook).toContain(`const dir = ${JSON.stringify(`${CUSTOM}/artifacts/runs`)};`);
    // ...and both BLOCKED messages name the same rendered directory.
    expect(hook).toContain(`${CUSTOM}/artifacts/runs/ unreadable`);
    expect(hook).toContain(`no totem spec run artifact under ${CUSTOM}/artifacts/runs/`);
  });

  it('pre-push guards are shell-quoted at the configured dir', () => {
    const hook = buildPrePushHook(render);
    expect(hook).toContain(`if [ -f "${CUSTOM}/compile-manifest.json" ]; then`);
    expect(hook).toContain(`if [ -f "${CUSTOM}/compiled-rules.json" ]; then`);
    expect(hook).toContain(`[ -f "README.md" ] && [ -f "${CUSTOM}/compiled-rules.json" ]`);
  });

  it('the two grep filters are BRE-escaped at the configured dir', () => {
    // `knowledge` carries no BRE metacharacter, so it renders verbatim...
    expect(buildHookContent(render)).toContain(`grep -q '${CUSTOM}/lessons/'`);
    expect(buildPostCheckoutHookContent(render)).toContain(`grep -q '${CUSTOM}/'`);
    // ...while a dotted directory has its `.` escaped, exactly as `.totem` does
    // in the shipped hooks (a bare `.` would match any character).
    const dotted = { ...DEFAULT_RENDER, totemDir: '.knowledge' };
    expect(buildHookContent(dotted)).toContain(String.raw`grep -q '\.knowledge/lessons/'`);
    expect(buildPostCheckoutHookContent(dotted)).toContain(String.raw`grep -q '\.knowledge/'`);
  });

  it('post-checkout tests the configured dir for existence', () => {
    expect(buildPostCheckoutHookContent(render)).toContain(`[ -d "${CUSTOM}" ]`);
  });

  it('a dollar sign or a backtick is refused rather than re-quoted (amendment A2)', () => {
    // `$` and a backtick are the only characters that would stay ACTIVE inside the
    // double-quoted `sh` words the guards use. Refusing them (instead of switching
    // those values to single quotes) keeps ONE quoting regime for every `sh` site —
    // the plain double-quoted form `tools/*` ships — so there is no second form to
    // get wrong.
    for (const bad of ['a$b', 'a`b']) {
      expect(() => buildPrePushHook({ ...DEFAULT_RENDER, totemDir: bad })).toThrow(
        /Refusing to render git hooks/,
      );
      expect(() => buildPostCheckoutHookContent({ ...DEFAULT_RENDER, totemDir: bad })).toThrow(
        /Refusing to render git hooks/,
      );
    }
    // ...and an accepted value never renders a single-quoted guard word.
    expect(buildPrePushHook(render)).not.toContain(`[ -f '${CUSTOM}/`);
    expect(buildPostCheckoutHookContent(render)).not.toContain(`[ -d '${CUSTOM}'`);
  });
});

// ─── C4: the refusal ─────────────────────────────────────

describe('an unrenderable totemDir is refused loudly (C4)', () => {
  it.each([
    ['a single quote', "it's"],
    ['a double quote', 'a"b'],
    ['a backslash', 'a\\b'],
    ['a dollar sign', 'a$b'],
    ['a backtick', 'a`b'],
    ['a newline', 'a\nb'],
    ['a control character', `a${String.fromCharCode(7)}b`],
  ])('refuses %s, naming the value', (_label, totemDir) => {
    let message = '';
    try {
      assertRenderableTotemDir(totemDir);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('Refusing to render git hooks');
    // The message must NAME the offending value so the operator can find it.
    expect(message).toContain(JSON.stringify(totemDir));
    // ...and point at the fix.
    expect(message).toContain('totem hook install --force');
  });

  it.each([
    ['buildPreCommitHook', (o: HookRenderOptions) => buildPreCommitHook(o)],
    ['buildPrePushHook', (o: HookRenderOptions) => buildPrePushHook(o)],
    ['buildHookContent', (o: HookRenderOptions) => buildHookContent(o)],
    ['buildPostCheckoutHookContent', (o: HookRenderOptions) => buildPostCheckoutHookContent(o)],
  ])('%s refuses rather than rendering an injectable hook', (_name, build) => {
    expect(() => build({ ...DEFAULT_RENDER, totemDir: "x';rm -rf /;'" })).toThrow(
      /Refusing to render git hooks/,
    );
  });

  it('accepts the ordinary shapes', () => {
    for (const ok of ['.totem', 'knowledge', 'a/b/c', '.totem-2', 'dir with spaces']) {
      expect(() => assertRenderableTotemDir(ok)).not.toThrow();
    }
  });
});

// ─── C1: the resolver ────────────────────────────────────

describe('resolveHookRenderOptions — the one config→render seam (C1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-render-opts-'));
    // A lockfile so fallbackCmd is deterministic across machines.
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function writeConfig(body: string): void {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), body, 'utf-8');
  }

  const BASE_TARGETS =
    'targets:\n  - glob: "docs/*.md"\n    type: lesson\n    strategy: markdown-heading\n';

  it('reads totemDir and hooks.tier from the repo config', async () => {
    writeConfig(`${BASE_TARGETS}totemDir: knowledge\nhooks:\n  tier: strict\n`);
    const render = await resolveHookRenderOptions(tmpDir);
    expect(render.totemDir).toBe('knowledge');
    expect(render.tier).toBe('strict');
    expect(render.fallbackCmd).toBe('pnpm dlx @mmnto/cli');
    expect(render.configPath).toBe(path.join(tmpDir, 'totem.yaml'));
  });

  it('an explicit flag overrides the configured tier — never the configured totemDir', async () => {
    writeConfig(`${BASE_TARGETS}totemDir: knowledge\nhooks:\n  tier: strict\n`);
    const render = await resolveHookRenderOptions(tmpDir, { tier: 'standard' });
    expect(render.tier).toBe('standard');
    expect(render.totemDir).toBe('knowledge');
  });

  it('falls back to the schema default when the config pins no totemDir', async () => {
    writeConfig(BASE_TARGETS);
    const render = await resolveHookRenderOptions(tmpDir);
    expect(render.totemDir).toBe(DEFAULT_TOTEM_DIR);
    expect(render.tier).toBe('standard');
  });

  it('an unloadable config degrades to the defaults rather than throwing', async () => {
    writeConfig('targets: [oh no: {');
    const render = await resolveHookRenderOptions(tmpDir);
    expect(render.totemDir).toBe(DEFAULT_TOTEM_DIR);
    expect(render.tier).toBe('standard');
    expect(render.configPath).toBeUndefined();
  });

  it('the resolved options render the hook the WRITER agrees with (init-after-write)', async () => {
    // `totem init` writes the config, THEN installs hooks — so the hook must be
    // rendered from what is on disk at that moment, not from the flags init was
    // called with. Simulate exactly that ordering.
    writeConfig(`${BASE_TARGETS}totemDir: knowledge\n`);
    const render = await resolveHookRenderOptions(tmpDir);
    const hook = buildPreCommitHook({ ...render, tier: 'strict' });
    // The run store `totem spec` writes for this config is <totemDir>/artifacts/runs;
    // the hook's reader must name the same path.
    expect(hook).toContain(`const dir = "knowledge/artifacts/runs";`);
    expect(hook).not.toContain('.totem');
  });
});
