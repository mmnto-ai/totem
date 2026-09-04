import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstateExecFn, TotemRegistry } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import type { DiagnosticResult } from './doctor.js';
import {
  AGENTS_MD_REDIRECT_PATTERN,
  BYPASS_THRESHOLD,
  checkAgentsMdCanonical,
  checkCompiledRules,
  checkConfig,
  checkEmbeddingConfig,
  checkEstate,
  checkFreezes,
  checkGitHooks,
  checkGrandfatheredRules,
  checkIndex,
  checkLinkedIndexes,
  checkOllama,
  checkSecretLeaks,
  checkSecretsFileTracked,
  checkStaleRules,
  checkStrategyRoot,
  checkUpgradeCandidates,
  CLAUDE_MD_REDIRECT_MAX_BYTES,
  doctorCommand,
  doctorGateFailed,
  findLegacyGrandfatheredRules,
  findStaleRules,
  MIN_CONTEXT_EVENTS,
  MIN_EVENTS,
  NON_CODE_THRESHOLD,
  resolveStrictTier,
  runSelfHealing,
  V_1_13_0_SHIP_DATE_ISO,
} from './doctor.js';

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-'));
}

// ─── Config check ───────────────────────────────────────

describe('checkConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pass when totem.config.ts exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};');
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('totem.config.ts');
  });

  it('returns pass when totem.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: []');
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('totem.yaml');
  });

  it('returns fail when no config exists', () => {
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.remediation).toBe('totem init');
  });
});

// ─── Compiled rules check ───────────────────────────────

describe('checkCompiledRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pass with rule count when compiled-rules.json exists', () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [{ id: '1' }, { id: '2' }, { id: '3' }] }),
    );
    const result = checkCompiledRules(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('3 rules loaded');
  });

  it('returns warn when compiled-rules.json is missing', () => {
    const result = checkCompiledRules(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.remediation).toBe('totem compile');
  });
});

// ─── Git hooks check ────────────────────────────────────

describe('checkGitHooks', () => {
  // Shared by the currency cases (mmnto-ai/totem#2753 hoisted this out of the
  // custom-totemDir describe: since the compare runs on EVERY install, the
  // default-totemDir cases need the real canonical too). Uses the real builders,
  // so a template change moves the fixture with the code.
  async function installCanonical(
    dir: string,
    totemDir: string,
    tier: 'strict' | 'standard' = 'standard',
  ): Promise<void> {
    const {
      buildPreCommitHook,
      buildPrePushHook,
      buildHookContent,
      buildPostCheckoutHookContent,
      getFallbackCommand,
    } = await import('./install-hooks.js');
    const render = { tier, totemDir, fallbackCmd: getFallbackCommand(dir) };
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), buildPreCommitHook(render));
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), buildPrePushHook(render));
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), buildHookContent(render));
    fs.writeFileSync(path.join(hooksDir, 'post-checkout'), buildPostCheckoutHookContent(render));
  }

  /** The measured liquid-city extension shape (`tools/git-hooks/install.cjs`,
   *  block 1): a `# [lc] …` comment line, THEN the attestation, then the
   *  extension's commands — joined the way install.cjs joins it. */
  const ATTESTED_TRAILER = [
    '',
    '# [lc] docs-inject extension',
    '# <!-- totem:fork reason="lc docs-inject pre-commit extension (divergence-census justified fork)" owner="satur8d" attested="2026-06-07" -->',
    'sh "tools/git-hooks/pre-commit-docs-inject.sh"',
    '',
  ].join('\n');

  /** The canonical with ONE comment line inside the managed block altered. */
  function withStaleComment(canonical: string, endMarker: string): string {
    const lines = canonical.split('\n');
    const endLine = lines.findIndex((line) => line.includes(endMarker));
    const commentLine = lines.findIndex(
      (line, i) =>
        i > 1 && i < endLine && line.trimStart().startsWith('#') && !line.includes('[totem]'),
    );
    if (commentLine === -1) throw new Error('no alterable comment line inside the managed block');
    lines[commentLine] = `${lines[commentLine]} (frozen at an older template)`;
    return lines.join('\n');
  }

  /** The four hooks, each carrying `trailer` after its end marker — canonical, or
   *  (`stale`) one comment line behind it. */
  async function installWithTrailer(
    dir: string,
    trailer: string,
    opts: { stale: boolean },
  ): Promise<void> {
    const hooks = await import('./install-hooks.js');
    const render = {
      tier: 'standard' as const,
      totemDir: '.totem',
      fallbackCmd: hooks.getFallbackCommand(dir),
    };
    const hooksDir = path.join(dir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const roster: [string, string, string][] = [
      ['pre-commit', hooks.buildPreCommitHook(render), hooks.TOTEM_PRECOMMIT_END],
      ['pre-push', hooks.buildPrePushHook(render), hooks.TOTEM_PREPUSH_END],
      ['post-merge', hooks.buildHookContent(render), hooks.TOTEM_HOOK_END],
      ['post-checkout', hooks.buildPostCheckoutHookContent(render), hooks.TOTEM_CHECKOUT_END],
    ];
    for (const [file, canonical, endMarker] of roster) {
      const block = opts.stale ? withStaleComment(canonical, endMarker) : canonical;
      fs.writeFileSync(path.join(hooksDir, file), block + trailer);
    }
  }

  it('returns skip when not a git repo', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = await checkGitHooks(tmpDir);
      expect(result.status).toBe('skip');
      expect(result.message).toBe('Not a git repository');
    } finally {
      cleanTmpDir(tmpDir);
    }
  });

  it('returns warn when hooks are missing in a git repo', async () => {
    const tmpDir = makeTmpDir();
    try {
      const { execSync } = require('node:child_process');
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      const result = await checkGitHooks(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('missing');
      expect(result.remediation).toBe('totem hooks');
    } finally {
      cleanTmpDir(tmpDir);
    }
  });

  it('returns pass when all four managed blocks are the current canonical', async () => {
    const tmpDir = makeTmpDir();
    try {
      const { execSync } = require('node:child_process');
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      await installCanonical(tmpDir, '.totem');
      const result = await checkGitHooks(tmpDir);
      expect(result.status).toBe('pass');
      expect(result.message).toContain('All 4 hooks');
    } finally {
      cleanTmpDir(tmpDir);
    }
  });

  // mmnto-ai/totem#2753: presence was never the question the row is asked. Until
  // this slice the marker alone passed on the default totemDir, so a hook frozen at
  // an older template read as healthy (`All 4 hooks installed` over two 1.121.0
  // hooks under a 1.123.0 CLI, mmnto-ai/liquid-city#1174).
  it('WARNs on marker-headed hooks whose managed block is not the canonical (default totemDir)', async () => {
    const tmpDir = makeTmpDir();
    try {
      const { execSync } = require('node:child_process');
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      const hooksDir = path.join(tmpDir, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hooks = [
        { file: 'pre-commit', marker: '[totem] pre-commit hook' },
        { file: 'pre-push', marker: '[totem] pre-push hook' },
        { file: 'post-merge', marker: '[totem] post-merge hook' },
        { file: 'post-checkout', marker: '[totem] post-checkout hook' },
      ];
      for (const { file, marker } of hooks) {
        fs.writeFileSync(path.join(hooksDir, file), `#!/bin/sh\n# ${marker}\necho ok`);
      }
      const result = await checkGitHooks(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain("totemDir '.totem'");
      expect(result.message).toContain('the managed block is stale');
    } finally {
      cleanTmpDir(tmpDir);
    }
  });

  // mmnto-ai/totem#2692 C6. `doctor --parity` regenerates the canonical at the
  // configured `totemDir` and would catch this — but it is pin-gated behind
  // `orient.parityManifest`, so the always-on row gains ONE conditional
  // whole-file compare, and ONLY when the repo configures a non-default dir.
  describe('custom totemDir (mmnto-ai/totem#2692 C6)', () => {
    it('WARNs when the installed hooks were rendered for a different totemDir', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        // Hooks on disk still name `.totem/`; the repo configures `knowledge/`.
        await installCanonical(tmpDir, '.totem');
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('warn');
        expect(result.message).toContain("totemDir 'knowledge'");
        expect(result.message).toContain('pre-commit');
        expect(result.remediation).toBe('totem hook install --force');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('PASSES when the installed hooks match the configured totemDir', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installCanonical(tmpDir, 'knowledge');
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('pass');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // mmnto-ai/totem#2753 REPLACED the pre-#2753 assertion here ("does NOT compare
    // content on the default totemDir") — that early return WAS the blind spot. The
    // default is now compared like any other value, whether it is configured
    // explicitly or left undefined.
    it('compares content on the default totemDir too, configured explicitly or not', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installCanonical(tmpDir, '.totem');
        expect((await checkGitHooks(tmpDir, { totemDir: '.totem' })).status).toBe('pass');
        expect((await checkGitHooks(tmpDir)).status).toBe('pass');

        // One comment line behind → stale on BOTH spellings of the default.
        const { buildPrePushHook, getFallbackCommand, TOTEM_PREPUSH_END } =
          await import('./install-hooks.js');
        fs.writeFileSync(
          path.join(tmpDir, '.git', 'hooks', 'pre-push'),
          withStaleComment(
            buildPrePushHook({
              tier: 'standard',
              totemDir: '.totem',
              fallbackCmd: getFallbackCommand(tmpDir),
            }),
            TOTEM_PREPUSH_END,
          ),
        );
        for (const config of [{ totemDir: '.totem' }, undefined]) {
          const result = await checkGitHooks(tmpDir, config);
          expect(result.status).toBe('warn');
          expect(result.message).toContain('pre-push');
          expect(result.message).toContain('the managed block is stale');
          expect(result.remediation).toBe('totem hook install --force');
        }
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Amendment A4: the compare is BLOCK-scoped and the remedy is ownership-aware.
    // `installGitHook --force` rewrites the whole file, so a user hook carrying
    // an APPENDED totem block must be judged on the block and steered away from
    // `--force`.
    async function installWithAppendedPreCommit(
      dir: string,
      othersTotemDir: string,
      preCommitTotemDir: string,
    ): Promise<void> {
      const { buildPreCommitHook } = await import('./install-hooks.js');
      await installCanonical(dir, othersTotemDir);
      const block = buildPreCommitHook({ tier: 'standard', totemDir: preCommitTotemDir })
        .replace(/^#!\/bin\/sh\n/, '')
        .trimStart();
      fs.writeFileSync(
        path.join(dir, '.git', 'hooks', 'pre-commit'),
        `#!/bin/sh\necho "user pre-commit"\n\n${block}`,
      );
    }

    it('judges an APPENDED totem block on the block alone, and never prescribes --force for it', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        // The three others are canonical for `knowledge`; pre-commit is a USER
        // hook whose appended totem block was rendered for `.totem`.
        await installWithAppendedPreCommit(tmpDir, 'knowledge', '.totem');
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('warn');
        expect(result.message).toContain('pre-commit');
        expect(result.message).not.toContain('pre-push');
        expect(result.remediation).not.toBe('totem hook install --force');
        expect(result.remediation).toContain('delete the totem block');
        expect(result.remediation).toContain('pre-commit');
        expect(result.remediation).toContain('would overwrite your own hook content');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('PASSES a user hook whose appended block matches the configured totemDir', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installWithAppendedPreCommit(tmpDir, 'knowledge', 'knowledge');
        expect((await checkGitHooks(tmpDir, { totemDir: 'knowledge' })).status).toBe('pass');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Amendment A10 (falsification F5c): a LEGACY hook — start marker, NO end
    // marker — cannot be bounded, so it is compared whole and takes the one
    // `--force` install-hooks.ts prescribes for it; the appended-hook remedy
    // ("delete the block through its end marker") would be unfollowable.
    it('names --force (not the delete-and-re-append line) for a legacy hook with no end marker', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const { buildPreCommitHook } = await import('./install-hooks.js');
        await installCanonical(tmpDir, 'knowledge');
        const legacy = buildPreCommitHook({ tier: 'standard', totemDir: '.totem' })
          .split('\n')
          .filter((line) => !line.includes('[totem] end pre-commit'))
          .join('\n');
        fs.writeFileSync(path.join(tmpDir, '.git', 'hooks', 'pre-commit'), legacy);
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('warn');
        expect(result.message).toContain('pre-commit');
        expect(result.remediation).toMatch(/^totem hook install --force/);
        expect(result.remediation).toContain('legacy hook with no end marker');
        expect(result.remediation).not.toContain('delete the totem block');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Amendment A10 (falsification F5d): the compare is on the totemDir axis ONLY.
    // A hook installed with --strict on a repo whose config pins no tier must not
    // read as totemDir drift — the prescribed `--force` would re-render it at
    // standard, a silent enforcement downgrade.
    it('does NOT report a tier-only difference as totemDir drift', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installCanonical(tmpDir, 'knowledge', 'strict');
        expect((await checkGitHooks(tmpDir, { totemDir: 'knowledge' })).status).toBe('pass');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Pass-2 F3: the tier is read from the TOTEM-OWNED block, not the whole file —
    // a user's own line carrying `TOTEM_HOOK_TIER="strict"` above an appended
    // standard block must not turn a matching hook into "totemDir drift".
    it('reads the tier from the totem block, not from a user line above it', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const { buildPrePushHook, getFallbackCommand } = await import('./install-hooks.js');
        await installCanonical(tmpDir, 'knowledge');
        const block = buildPrePushHook({
          tier: 'standard',
          totemDir: 'knowledge',
          fallbackCmd: getFallbackCommand(tmpDir),
        })
          .replace(/^#!\/bin\/sh\n/, '')
          .trimStart();
        fs.writeFileSync(
          path.join(tmpDir, '.git', 'hooks', 'pre-push'),
          `#!/bin/sh\nTOTEM_HOOK_TIER="strict" # a line of the user's own\necho mine\n\n${block}`,
        );
        expect((await checkGitHooks(tmpDir, { totemDir: 'knowledge' })).status).toBe('pass');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Pass-2 F4: a user line that merely QUOTES an end marker above a genuinely
    // unbounded (legacy) totem block must not make the sensor call it "appended"
    // and prescribe the unfollowable delete-through-its-end-marker remedy.
    it('classifies a legacy block as legacy even when a user line quotes the end marker', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const { buildPreCommitHook } = await import('./install-hooks.js');
        await installCanonical(tmpDir, 'knowledge');
        const legacyBlock = buildPreCommitHook({ tier: 'standard', totemDir: '.totem' })
          .split('\n')
          .filter((line) => !line.includes('[totem] end pre-commit'))
          .join('\n')
          .replace(/^#!\/bin\/sh\n/, '')
          .trimStart();
        fs.writeFileSync(
          path.join(tmpDir, '.git', 'hooks', 'pre-commit'),
          `#!/bin/sh\n# see the "# [totem] end pre-commit" line below\necho mine\n\n${legacyBlock}`,
        );
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('warn');
        expect(result.remediation).toMatch(/^totem hook install --force/);
        expect(result.remediation).toContain('legacy hook with no end marker');
        expect(result.remediation).not.toContain('delete the totem block');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // Pass-2 N5: a configured value the installer REFUSES never produced hooks —
    // the row stays marker-only rather than crashing or comparing against a
    // canonical that cannot exist (the same policy as `doctor --parity`).
    it('stays marker-only when the configured totemDir is one the installer refuses', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installCanonical(tmpDir, '.totem');
        expect((await checkGitHooks(tmpDir, { totemDir: '.' })).status).toBe('pass');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('still reports totemDir drift on a strict-tier hook (the tier is read from the hook, not assumed)', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installCanonical(tmpDir, '.totem', 'strict');
        const result = await checkGitHooks(tmpDir, { totemDir: 'knowledge' });
        expect(result.status).toBe('warn');
        expect(result.message).toContain('pre-commit');
        expect(result.message).toContain('pre-push');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });
  });

  // ── Attested extensions on the DEFAULT totemDir (mmnto-ai/totem#2753) ──
  //
  // The measured liquid-city shape: hooks totem owns through their end marker, with
  // an attested `totem:fork` extension after it. A bare `totem hook install` now
  // cures these, so the row must both SEE them and prescribe the bare command.
  describe('attested extensions (mmnto-ai/totem#2753)', () => {
    it('WARNs on a stale block beside an attested trailer and prescribes the bare install', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installWithTrailer(tmpDir, ATTESTED_TRAILER, { stale: true });
        const result = await checkGitHooks(tmpDir, {});
        expect(result.status).toBe('warn');
        expect(result.message).toContain("totemDir '.totem'");
        expect(result.message).toContain('the managed block is stale');
        for (const file of ['pre-commit', 'pre-push', 'post-merge', 'post-checkout']) {
          expect(result.message).toContain(file);
        }
        expect(result.remediation).toBe(
          'totem hook install (the managed block is rewritten in place; your attested extension after the end marker is carried through unchanged)',
        );
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // The same case with the totemDir spelled out — this is precisely what the
    // pre-#2753 early return hid.
    it('WARNs identically when the default totemDir is configured explicitly', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installWithTrailer(tmpDir, ATTESTED_TRAILER, { stale: true });
        const result = await checkGitHooks(tmpDir, { totemDir: '.totem' });
        expect(result.status).toBe('warn');
        expect(result.remediation).toContain('totem hook install');
        expect(result.remediation).toContain(
          'your attested extension after the end marker is carried through unchanged',
        );
        expect(result.remediation).not.toContain('--force');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('PASSES when the managed block is current beside an attested trailer', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installWithTrailer(tmpDir, ATTESTED_TRAILER, { stale: false });
        const result = await checkGitHooks(tmpDir, {});
        expect(result.status).toBe('pass');
        expect(result.message).toBe('All 4 hooks installed');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('keeps the delete-and-re-append remedy for an UNATTESTED trailer', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        await installWithTrailer(tmpDir, '# my own extension\necho "[me] hi"\n', { stale: true });
        const result = await checkGitHooks(tmpDir, {});
        expect(result.status).toBe('warn');
        expect(result.remediation).toContain('delete the totem block');
        expect(result.remediation).toContain('would overwrite your own hook content');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // The corner the classification is gated for: the trailer IS attested, but the
    // user's own lines sit ABOVE the totem block, so the marker does not open the
    // file and `installGitHook` declines. Prescribing the bare install here would
    // ship an instruction that does nothing (mmnto-ai/totem#2532) — the row must fall
    // through to the appended remedy, which does work on this file.
    it('does NOT prescribe the carry-through for an attested trailer under a user PREAMBLE', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const { buildPreCommitHook, TOTEM_PRECOMMIT_END } = await import('./install-hooks.js');
        // Three canonical hooks; pre-commit gets user lines ABOVE a stale block and
        // an attested extension BELOW its end marker.
        await installCanonical(tmpDir, '.totem');
        const staleBlock = withStaleComment(
          buildPreCommitHook({ tier: 'standard', totemDir: '.totem' }),
          TOTEM_PRECOMMIT_END,
        )
          .replace(/^#!\/bin\/sh\n/, '')
          .trimStart();
        fs.writeFileSync(
          path.join(tmpDir, '.git', 'hooks', 'pre-commit'),
          `#!/bin/sh\necho "user pre-commit"\n\n${staleBlock}${ATTESTED_TRAILER}`,
        );

        const result = await checkGitHooks(tmpDir, {});

        expect(result.status).toBe('warn');
        expect(result.message).toContain('pre-commit');
        expect(result.message).not.toContain('pre-push');
        expect(result.remediation).toContain('delete the totem block');
        expect(result.remediation).toContain('pre-commit');
        expect(result.remediation).toContain('would overwrite your own hook content');
        // The cure the installer would decline on this file is never named.
        expect(result.remediation).not.toContain('carried through unchanged');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // ── Mixed shapes in one repo (fold F6/F8, narrowed on fold 3 F5) ──
    //
    // Each shape contributes its own clause. A filename is named once, EXCEPT that
    // the legacy note keeps its names when the `--force` clause lists more than the
    // legacy hooks — otherwise the reader cannot tell which of the hooks it just
    // listed is the legacy one. The sibling test below covers the case where the
    // clause named exactly the legacy file and the note therefore drops its names.
    it('composes one clause per shape; the legacy note names its file when the --force clause lists more than the legacy hooks (legacy + owned-whole + attested)', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const hooks = await import('./install-hooks.js');
        const render = {
          tier: 'standard' as const,
          totemDir: '.totem',
          fallbackCmd: hooks.getFallbackCommand(tmpDir),
        };
        const hooksDir = path.join(tmpDir, '.git', 'hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        // post-checkout stays canonical; the other three each take a shape.
        fs.writeFileSync(
          path.join(hooksDir, 'post-checkout'),
          hooks.buildPostCheckoutHookContent(render),
        );
        // legacy: a stale block with its end-marker line removed.
        fs.writeFileSync(
          path.join(hooksDir, 'pre-commit'),
          withStaleComment(hooks.buildPreCommitHook(render), hooks.TOTEM_PRECOMMIT_END)
            .split('\n')
            .filter((line) => !line.includes(hooks.TOTEM_PRECOMMIT_END))
            .join('\n'),
        );
        // owned-whole: a stale block, nothing after the end marker.
        fs.writeFileSync(
          path.join(hooksDir, 'pre-push'),
          withStaleComment(hooks.buildPrePushHook(render), hooks.TOTEM_PREPUSH_END),
        );
        // appended-attested: a stale block with the liquid-city extension after it.
        fs.writeFileSync(
          path.join(hooksDir, 'post-merge'),
          withStaleComment(hooks.buildHookContent(render), hooks.TOTEM_HOOK_END) + ATTESTED_TRAILER,
        );

        const result = await checkGitHooks(tmpDir, {});

        expect(result.status).toBe('warn');
        const remediation = result.remediation ?? '';
        // Three clauses, one per shape present.
        expect(remediation).toContain('totem hook install');
        expect(remediation).toContain('carried through unchanged');
        expect(remediation).toContain('--force');
        // The `--force` clause names BOTH forceable hooks, so the note must keep the
        // legacy filename — otherwise the reader cannot tell which of the two is the
        // legacy one (fold 3 F5). pre-commit therefore appears twice by design.
        expect(remediation).toContain('`totem hook install --force` for pre-commit, pre-push');
        expect(remediation).toContain(
          '(pre-commit: a legacy hook with no end marker — back up any lines of your own first)',
        );
        expect(remediation.split('pre-commit').length - 1).toBe(2);
        for (const file of ['pre-push', 'post-merge']) {
          expect(remediation.split(file).length - 1).toBe(1);
        }
        // No plain `appended` row, so the trailing --force warning is absent.
        expect(remediation).not.toContain('would overwrite your own hook content');
        expect(remediation).not.toContain('delete the totem block');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    // The complementary case: the `--force` clause names EXACTLY the legacy file, so
    // repeating it in the note would read as two hooks. There the note drops names.
    it('drops the legacy names from the note when the --force clause named exactly them', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const hooks = await import('./install-hooks.js');
        const render = {
          tier: 'standard' as const,
          totemDir: '.totem',
          fallbackCmd: hooks.getFallbackCommand(tmpDir),
        };
        await installCanonical(tmpDir, '.totem');
        const hooksDir = path.join(tmpDir, '.git', 'hooks');
        // legacy pre-commit (the only forceable row) + attested pre-push.
        fs.writeFileSync(
          path.join(hooksDir, 'pre-commit'),
          withStaleComment(hooks.buildPreCommitHook(render), hooks.TOTEM_PRECOMMIT_END)
            .split('\n')
            .filter((line) => !line.includes(hooks.TOTEM_PRECOMMIT_END))
            .join('\n'),
        );
        fs.writeFileSync(
          path.join(hooksDir, 'pre-push'),
          withStaleComment(hooks.buildPrePushHook(render), hooks.TOTEM_PREPUSH_END) +
            ATTESTED_TRAILER,
        );

        const result = await checkGitHooks(tmpDir, {});

        const remediation = result.remediation ?? '';
        expect(remediation).toContain('`totem hook install --force` for pre-commit');
        expect(remediation).toContain(
          '(a legacy hook with no end marker — back up any lines of your own first)',
        );
        expect(remediation).not.toContain('(pre-commit: a legacy hook');
        expect(remediation.split('pre-commit').length - 1).toBe(1);
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('pluralizes the legacy note when more than one hook is legacy', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const hooks = await import('./install-hooks.js');
        const render = {
          tier: 'standard' as const,
          totemDir: '.totem',
          fallbackCmd: hooks.getFallbackCommand(tmpDir),
        };
        await installCanonical(tmpDir, '.totem');
        const hooksDir = path.join(tmpDir, '.git', 'hooks');
        const stripEnd = (text: string, endMarker: string): string =>
          text
            .split('\n')
            .filter((line) => !line.includes(endMarker))
            .join('\n');
        fs.writeFileSync(
          path.join(hooksDir, 'pre-commit'),
          stripEnd(
            withStaleComment(hooks.buildPreCommitHook(render), hooks.TOTEM_PRECOMMIT_END),
            hooks.TOTEM_PRECOMMIT_END,
          ),
        );
        fs.writeFileSync(
          path.join(hooksDir, 'pre-push'),
          stripEnd(
            withStaleComment(hooks.buildPrePushHook(render), hooks.TOTEM_PREPUSH_END),
            hooks.TOTEM_PREPUSH_END,
          ),
        );

        const result = await checkGitHooks(tmpDir, {});

        expect(result.status).toBe('warn');
        // The two stale hooks are the only stale hooks, so the `--force` clause
        // covers them all and names none — the note therefore carries the names, and
        // reads as a plural.
        expect(result.remediation).toBe(
          'totem hook install --force (pre-commit, pre-push: legacy hooks with no end marker — back up any lines of your own first)',
        );
        expect(result.remediation).not.toContain('a legacy hook with no end marker');
      } finally {
        cleanTmpDir(tmpDir);
      }
    });

    it('composes two clauses and keeps the --force warning when appended and attested mix', async () => {
      const tmpDir = makeTmpDir();
      try {
        execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
        const hooks = await import('./install-hooks.js');
        const render = {
          tier: 'standard' as const,
          totemDir: '.totem',
          fallbackCmd: hooks.getFallbackCommand(tmpDir),
        };
        await installCanonical(tmpDir, '.totem');
        const hooksDir = path.join(tmpDir, '.git', 'hooks');
        // appended: user lines above a stale block.
        const staleBlock = withStaleComment(
          hooks.buildPreCommitHook({ tier: 'standard', totemDir: '.totem' }),
          hooks.TOTEM_PRECOMMIT_END,
        )
          .replace(/^#!\/bin\/sh\n/, '')
          .trimStart();
        fs.writeFileSync(
          path.join(hooksDir, 'pre-commit'),
          `#!/bin/sh\necho "user pre-commit"\n\n${staleBlock}`,
        );
        // appended-attested: a stale block with the liquid-city extension after it.
        fs.writeFileSync(
          path.join(hooksDir, 'pre-push'),
          withStaleComment(hooks.buildPrePushHook(render), hooks.TOTEM_PREPUSH_END) +
            ATTESTED_TRAILER,
        );

        const result = await checkGitHooks(tmpDir, {});

        expect(result.status).toBe('warn');
        const remediation = result.remediation ?? '';
        expect(remediation).toContain('delete the totem block');
        expect(remediation).toContain('carried through unchanged');
        expect(remediation).toContain('would overwrite your own hook content');
        expect(remediation).not.toContain('--force for');
        for (const file of ['pre-commit', 'pre-push']) {
          expect(remediation.split(file).length - 1).toBe(1);
        }
      } finally {
        cleanTmpDir(tmpDir);
      }
    });
  });

  // The honest could-not-compare arm (Tenet 13): when the installer module itself
  // cannot load there is no canonical to compare against AND no default to name, so
  // the row says so rather than passing on an unexamined tree or printing
  // `totemDir 'undefined'` (fold F9).
  it('warns "could not be compared" when the installer module fails to load', async () => {
    const tmpDir = makeTmpDir();
    try {
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      await installCanonical(tmpDir, '.totem');
      vi.resetModules();
      vi.doMock('./install-hooks.js', () => {
        throw new Error('boom: install-hooks unloadable');
      });
      const { checkGitHooks: freshCheckGitHooks } = await import('./doctor.js');

      const result = await freshCheckGitHooks(tmpDir, {});

      expect(result.status).toBe('warn');
      expect(result.message).toContain('could not be compared');
      // `totemDir` is resolved FROM the module that failed, so it stays unresolved.
      expect(result.message).toContain("totemDir 'unresolved'");
      expect(result.remediation).toContain('totem hook install --force');
    } finally {
      vi.doUnmock('./install-hooks.js');
      vi.resetModules();
      cleanTmpDir(tmpDir);
    }
  });
});

// ─── Secret leak check ─────────────────────────────────

describe('checkSecretLeaks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pass when no secrets are found', async () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\nNo secrets here.');
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No leaked keys detected');
  });

  it('returns fail when a real key pattern is found', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'Use this key: sk-abcdefghijklmnopqrstuvwxyz1234567890',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('does NOT flag placeholder strings as leaks', async () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Set your key: sk-your-key-here-placeholder');
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('returns pass when no files to scan exist', async () => {
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No files to scan');
  });

  it('detects GitHub personal access tokens', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678a',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('detects Google API keys', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'key: AIzaSyA1234567890abcdefghijklmnopqrstuvw',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('scans lesson files in .totem/lessons/', async () => {
    const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'secret-lesson.md'),
      'Do not use: sk-ant-abcdefghijklmnopqrstuvwxyz',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });
});

// ─── Embedding config check ─────────────────────────────

describe('checkEmbeddingConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns skip when no config exists', () => {
    const result = checkEmbeddingConfig(tmpDir);
    expect(result.status).toBe('skip');
  });

  it('returns warn when no embedding is configured', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }] };",
    );
    const result = checkEmbeddingConfig(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Lite tier');
  });

  // mmnto-ai/totem#1908 — Missing env key is operator-setup state, not a
  // repo defect; classified as `warn` so `doctor --strict` doesn't gate on
  // CI environments that intentionally lack the key. Mirrors `checkOllama`
  // warn-on-unreachable. CI workflow `totem-doctor.yml` regression coverage.

  it('returns warn (not fail) when OpenAI configured but OPENAI_API_KEY missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [], embedding: { provider: 'openai' } };",
    );
    const originalKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const result = checkEmbeddingConfig(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('OPENAI_API_KEY missing');
      expect(result.remediation).toContain('OPENAI_API_KEY');
    } finally {
      if (originalKey !== undefined) process.env['OPENAI_API_KEY'] = originalKey;
    }
  });

  it('returns warn (not fail) when Gemini configured but API key missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [], embedding: { provider: 'gemini' } };",
    );
    const originalGemini = process.env['GEMINI_API_KEY'];
    const originalGoogle = process.env['GOOGLE_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    try {
      const result = checkEmbeddingConfig(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('API key missing');
      expect(result.remediation).toContain('GEMINI_API_KEY');
    } finally {
      if (originalGemini !== undefined) process.env['GEMINI_API_KEY'] = originalGemini;
      if (originalGoogle !== undefined) process.env['GOOGLE_API_KEY'] = originalGoogle;
    }
  });
});

// ─── Ollama probe (mmnto-ai/totem#1851) ─────────────────

describe('checkOllama', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'pass' when Ollama is reachable at the default URL", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const result = await checkOllama();
    expect(result.name).toBe('Ollama');
    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://localhost:11434');
  });

  it("returns 'warn' with floor recommendation when Ollama is not reachable", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const result = await checkOllama();
    expect(result.name).toBe('Ollama');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('not reachable');
    expect(result.message).toContain('floor not satisfied');
    expect(result.remediation).toBeDefined();
    expect(result.remediation).toContain('https://ollama.com');
    expect(result.remediation).toContain('ollama pull nomic-embed-text');
  });

  it("returns 'warn' when probe times out (no hang, no throw)", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    const result = await checkOllama();
    expect(result.status).toBe('warn');
  });

  it("honors custom baseUrl from config when provider is 'ollama'", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request): Promise<Response> => {
        calls.push(typeof url === 'string' ? url : url.toString());
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    );

    const result = await checkOllama({
      embedding: { provider: 'ollama', baseUrl: 'http://ollama.internal:9999' },
    });

    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://ollama.internal:9999');
    expect(calls.some((u) => u.includes('http://ollama.internal:9999/api/tags'))).toBe(true);
  });

  it("ignores embedding.baseUrl when provider is not 'ollama'", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request): Promise<Response> => {
        calls.push(typeof url === 'string' ? url : url.toString());
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    );

    // Defensive: even if a non-ollama config carries a stray baseUrl-shaped
    // field (it can't via the discriminated union, but checkOllama receives
    // a widened narrow shape), the probe must use the default URL.
    const result = await checkOllama({
      embedding: { provider: 'gemini', baseUrl: 'http://wrong.example:9999' },
    });

    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://localhost:11434');
    expect(calls.some((u) => u.includes('http://localhost:11434/api/tags'))).toBe(true);
    expect(calls.every((u) => !u.includes('http://wrong.example:9999'))).toBe(true);
  });
});

// ─── Index health check ─────────────────────────────────

describe('checkIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns skip when no embedding is configured (Lite tier)', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const result = checkIndex(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('Lite tier');
  });
});

// ─── doctorCommand integration ──────────────────────────

// Single source of truth for both the diagnostic count and the per-name
// enumeration in this suite. Add a check to `doctorCommand` → add the name
// here. Drift between count and name list is impossible by construction.
const EXPECTED_DIAGNOSTIC_NAMES = [
  'Config',
  'Compiled Rules',
  'Git Hooks',
  'Prepare Wrapper',
  'Embedding',
  'Ollama',
  'Index',
  'Linked Indexes',
  'Strategy Root',
  'Secret Scan',
  'Secrets File Security',
  'AGENTS.md Canonical',
  'Upgrade Candidates',
  'Stale Rules',
  'Grandfathered Rules',
  'Freeze state',
  'Estate',
  'Seat Identity',
] as const;

/**
 * The ambient `Estate` row reads the real user-level registry and shells git at
 * every repo listed there. Every `doctorCommand` call in this suite passes an
 * EMPTY registry through the seam so the suite stays hermetic — same reason the
 * Ollama probe's `fetch` is mocked above.
 */
const HERMETIC = { estateSeamsForTest: { registry: {}, wtRoots: [] as string[] } } as const;

describe('doctorCommand', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Set up a minimal valid workspace
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );

    // checkOllama transitively probes http://localhost:11434/api/tags via the
    // exported isOllamaAvailable. Force it to resolve `false` deterministically
    // so this integration suite stays environment-independent and doesn't pay
    // the 3s AbortSignal timeout in CI (mmnto-ai/totem#1860 CR R1).
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('runs without throwing', async () => {
    const results = await doctorCommand(HERMETIC);
    expect(results).toBeDefined();
    expect(results).toHaveLength(EXPECTED_DIAGNOSTIC_NAMES.length);
  });

  it('returns correct check names', async () => {
    const results = await doctorCommand(HERMETIC);
    const names = results.map((r: DiagnosticResult) => r.name);
    expect(names).toEqual(expect.arrayContaining([...EXPECTED_DIAGNOSTIC_NAMES]));
  });
});

// ─── Output format ──────────────────────────────────────

describe('doctorCommand output', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [{ id: '1' }] }),
    );

    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // See sibling describe's beforeEach (mmnto-ai/totem#1860 CR R1).
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('outputs all check names in console output', async () => {
    await doctorCommand(HERMETIC);
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Config');
    expect(output).toContain('Compiled Rules');
    expect(output).toContain('Git Hooks');
    expect(output).toContain('Embedding');
    expect(output).toContain('Ollama');
    expect(output).toContain('Index');
    expect(output).toContain('Linked Indexes');
    expect(output).toContain('Secret Scan');
    expect(output).toContain('Secrets File Security');
    expect(output).toContain('Upgrade Candidates');
    expect(output).toContain('Stale Rules');
  });

  it('outputs summary line with pass/warn/fail counts', async () => {
    await doctorCommand(HERMETIC);
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toMatch(/\d+ passed/);
    expect(output).toMatch(/\d+ warnings/);
    expect(output).toMatch(/\d+ failures/);
  });
});

// ─── Strict mode contract (mmnto-ai/totem#1908) ─────────
//
// `doctorCommand` itself is unchanged — it returns `DiagnosticResult[]` and
// does NOT touch `process.exit` / `process.exitCode`. The exit-code decision
// lives at the CLI edge (`packages/cli/src/index.ts` doctor action handler).
// These tests lock that contract: the function stays composable and the
// strict flag does not introduce process-exit side effects deep in the call
// graph (Tenet 4 / process-exit-masking trap from spec § Edge Cases).

describe('doctorCommand strict mode contract', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    originalExitCode = process.exitCode;

    // Minimal workspace (matches sibling describes).
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('does not modify process.exitCode when strict is true (CLI edge owns gating)', async () => {
    // Seed a guaranteed failure: no config means checkConfig returns `fail`.
    fs.unlinkSync(path.join(tmpDir, 'totem.config.ts'));
    process.exitCode = undefined;

    const results = await doctorCommand({ ...HERMETIC, strict: true });

    expect(results.some((r: DiagnosticResult) => r.status === 'fail')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not call process.exit regardless of strict flag', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_: number) => {
      throw new Error('process.exit should not be called by doctorCommand');
    }) as never);

    await doctorCommand({ ...HERMETIC, strict: true });
    await doctorCommand({ ...HERMETIC, strict: false });
    await doctorCommand(HERMETIC);

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('returns the same DiagnosticResult[] shape regardless of strict flag', async () => {
    const resultsStrict = await doctorCommand({ ...HERMETIC, strict: true });
    const resultsLoose = await doctorCommand({ ...HERMETIC, strict: false });

    expect(resultsStrict.map((r: DiagnosticResult) => r.name)).toEqual(
      resultsLoose.map((r: DiagnosticResult) => r.name),
    );
  });
});

// ─── Strict-warn tier (mmnto-ai/totem#2385) ─────────────
//
// `--strict=warn` upgrades the CLI-edge gate so warn-class diagnostics also
// exit non-zero — the machine-checkable all-wiring oracle. These helpers are
// pure; the exit-code mapping itself stays at the CLI edge.

describe('resolveStrictTier', () => {
  it('returns undefined when strict mode is off', async () => {
    await expect(resolveStrictTier(undefined)).resolves.toBeUndefined();
    await expect(resolveStrictTier(false)).resolves.toBeUndefined();
  });

  it('maps the bare flag and the explicit fail tier to fail', async () => {
    await expect(resolveStrictTier(true)).resolves.toBe('fail');
    await expect(resolveStrictTier('fail')).resolves.toBe('fail');
  });

  it('maps the warn tier', async () => {
    await expect(resolveStrictTier('warn')).resolves.toBe('warn');
  });

  it('throws fail-loud on an unknown tier', async () => {
    await expect(resolveStrictTier('banana')).rejects.toThrow('Unknown --strict tier "banana"');
    await expect(resolveStrictTier('')).rejects.toThrow('Unknown --strict tier');
  });
});

describe('doctorGateFailed', () => {
  const clean: DiagnosticResult[] = [
    { name: 'A', status: 'pass', message: '' },
    { name: 'B', status: 'skip', message: '' },
  ];
  const withWarn: DiagnosticResult[] = [...clean, { name: 'C', status: 'warn', message: '' }];
  const withFail: DiagnosticResult[] = [...clean, { name: 'D', status: 'fail', message: '' }];

  it('fail tier gates on fail only (pre-#2385 contract)', () => {
    expect(doctorGateFailed(clean, 'fail')).toBe(false);
    expect(doctorGateFailed(withWarn, 'fail')).toBe(false);
    expect(doctorGateFailed(withFail, 'fail')).toBe(true);
  });

  it('warn tier gates on warn and fail (all-wiring oracle)', () => {
    expect(doctorGateFailed(clean, 'warn')).toBe(false);
    expect(doctorGateFailed(withWarn, 'warn')).toBe(true);
    expect(doctorGateFailed(withFail, 'warn')).toBe(true);
  });

  it('skip never gates in either tier', () => {
    const onlySkip: DiagnosticResult[] = [{ name: 'S', status: 'skip', message: '' }];
    expect(doctorGateFailed(onlySkip, 'fail')).toBe(false);
    expect(doctorGateFailed(onlySkip, 'warn')).toBe(false);
  });

  // Sensor-class rows report but never gate (mmnto-ai/totem#2580 ruled scope).
  // The exemption rides the ROW, so widening the tier later cannot give a
  // sensor teeth by accident.
  it('a gateExempt warn row does not gate even under the warn tier', () => {
    const estateWarn: DiagnosticResult[] = [
      ...clean,
      { name: 'Estate', status: 'warn', message: '', gateExempt: true },
    ];
    expect(doctorGateFailed(estateWarn, 'warn')).toBe(false);
    expect(doctorGateFailed(estateWarn, 'fail')).toBe(false);
  });

  it('a non-exempt warn row alongside an exempt one still gates under the warn tier', () => {
    const mixed: DiagnosticResult[] = [
      { name: 'Estate', status: 'warn', message: '', gateExempt: true },
      { name: 'C', status: 'warn', message: '' },
    ];
    expect(doctorGateFailed(mixed, 'warn')).toBe(true);
    expect(doctorGateFailed(mixed, 'fail')).toBe(false);
  });

  // The exemption is scoped to ADVISORY statuses. A fail is a wiring failure
  // and no row may hide one — sensor rows never emit `fail`, so the narrowing
  // costs them nothing and closes the mislabelled-row hole.
  it('a gateExempt FAIL row still gates in both tiers', () => {
    const exemptFail: DiagnosticResult[] = [
      ...clean,
      { name: 'Sensor', status: 'fail', message: '', gateExempt: true },
    ];
    expect(doctorGateFailed(exemptFail, 'fail')).toBe(true);
    expect(doctorGateFailed(exemptFail, 'warn')).toBe(true);
  });
});

// ─── Ambient estate row (mmnto-ai/totem#2580) ───────────

describe('checkEstate', () => {
  const registryOf = (...paths: string[]): TotemRegistry =>
    Object.fromEntries(
      paths.map((p) => [
        p,
        { path: p, chunkCount: 1, lastSync: '2026-08-01T00:00:00.000Z', embedder: 'test' },
      ]),
    );

  let estateDir: string;

  beforeEach(() => {
    estateDir = fs.realpathSync(makeTmpDir());
  });

  afterEach(() => {
    cleanTmpDir(estateDir);
  });

  /** Canned git for `repo`; every other path answers as its own toplevel. */
  function seams(
    repo: string,
    opts: { throws?: boolean; toplevels?: Record<string, string>; failToplevel?: string[] } = {},
  ) {
    const listing = [
      `worktree ${repo.split(path.sep).join('/')}`,
      `HEAD ${'a'.repeat(40)}`,
      'branch refs/heads/main',
      '',
    ].join('\n');
    const fold = (p: string): string =>
      process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
    const toplevels = new Map(Object.entries(opts.toplevels ?? {}).map(([k, v]) => [fold(k), v]));
    const failToplevel = new Set((opts.failToplevel ?? []).map(fold));
    return {
      registry: registryOf(repo),
      now: Date.parse('2026-08-05T12:00:00.000Z'),
      // Pinned so a machine that has actually run `totem wt create` cannot
      // drag its real recorded roots into these assertions (#2580 slice 2).
      wtRoots: [] as string[],
      safeExec: ((_command: string, args: string[] = []): string => {
        if (opts.throws === true) throw new Error('git exploded');
        const cwd = args[2] ?? '';
        const verb = args.slice(3);
        if (verb[0] === 'rev-parse' && verb[1] === '--show-toplevel') {
          if (failToplevel.has(fold(cwd))) throw new Error('not a git repository');
          return (toplevels.get(fold(cwd)) ?? path.resolve(cwd)).split(path.sep).join('/');
        }
        if (verb[0] === 'worktree') {
          if (fold(cwd) !== fold(repo)) throw new Error('not a git repository');
          return listing;
        }
        if (verb[0] === 'rev-parse') return 'origin/main';
        return '';
      }) as EstateExecFn,
    };
  }

  it('skips when nothing is registered', async () => {
    const result = await checkEstate({ registry: {}, wtRoots: [] });
    expect(result.status).toBe('skip');
    expect(result.message).toContain('No registered repos');
  });

  // A corrupt registry must not collapse into the clean "nothing registered"
  // skip — the ambient row is the surface operators actually see, and it is
  // the one that would hide the failure. Drives the REAL readRegistry (no
  // registry seam) against a temp home holding an unparseable registry.json.
  it('warns (not skip) when the registry exists but cannot be read', async () => {
    const home = fs.realpathSync(makeTmpDir());
    fs.mkdirSync(path.join(home, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(home, '.totem', 'registry.json'), '{ not json', 'utf-8');
    const prevHome = process.env['HOME'];
    const prevProfile = process.env['USERPROFILE'];
    process.env['HOME'] = home;
    process.env['USERPROFILE'] = home;
    try {
      const result = await checkEstate();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('Registry unreadable');
      expect(result.gateExempt).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = prevHome;
      if (prevProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = prevProfile;
      cleanTmpDir(home);
    }
  });

  it('passes quietly on a clean estate, naming missing and unscannable counts', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const gone = path.join(estateDir, 'vanished');
    const base = seams(repo);
    const result = await checkEstate({
      ...base,
      registry: registryOf(repo, gone),
    });
    expect(result.status).toBe('pass');
    // The denominator is what was ENUMERATED — an entry that was missing, not a
    // git root, or unprobeable was never looked inside and must not inflate it.
    expect(result.message).toContain('1 enumerated repo(s)');
    expect(result.message).toContain('(1 missing)');
    expect(result.message).toContain('0 linked worktree(s)');
    expect(result.gateExempt).toBe(true);
  });

  it('names the not-git-root and unprobeable counts too', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const inside = path.join(repo, 'packages');
    fs.mkdirSync(inside, { recursive: true });
    const broken = path.join(estateDir, 'broken');
    fs.mkdirSync(broken, { recursive: true });
    const result = await checkEstate({
      ...seams(repo, { toplevels: { [inside]: repo }, failToplevel: [broken] }),
      registry: registryOf(repo, inside, broken),
    });
    expect(result.status).toBe('pass');
    expect(result.message).toContain('1 enumerated repo(s)');
    expect(result.message).toContain('1 not-git-root');
    expect(result.message).toContain('1 unprobeable');
  });

  it('warns with counts and the --estate remediation when husks exist', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(path.join(repo, '.claude', 'worktrees', 'agent-a'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude', 'worktrees', 'agent-b'), { recursive: true });
    const result = await checkEstate(seams(repo));
    expect(result.status).toBe('warn');
    expect(result.message).toContain('2 husk candidate(s)');
    expect(result.remediation).toContain('totem doctor --estate');
    expect(result.gateExempt).toBe(true);
  });

  // A git that fails on every invocation is NOT a scan crash: the scan is
  // fail-soft per probe, so this lands as unscannable rows and the row still
  // reports. Asserted so the two failure classes stay distinguishable.
  it('keeps reporting when every git probe fails, naming the unscannable count', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const result = await checkEstate(seams(repo, { throws: true }));
    expect(result.status).toBe('pass');
    expect(result.message).toContain('1 probe(s) unscannable');
  });

  it('warns (never throws) on a crash-class scan failure', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    // A malformed registry is the reachable crash class: EVERY exec call site
    // inside the scan is wrapped, so even a broken git seam degrades to
    // unscannable rows (asserted above) rather than throwing. What the catch
    // exists for is a crash BEFORE or AROUND the probes — a bad registry
    // shape, or the dynamic core import failing.
    const result = await checkEstate({ ...seams(repo), registry: { bad: null } as never });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Estate scan failed');
  });

  it('marks every row gateExempt so the sensor can never gate', async () => {
    const repo = path.join(estateDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const huskRepo = path.join(estateDir, 'husk-repo');
    fs.mkdirSync(path.join(huskRepo, '.claude', 'worktrees', 'agent-a'), { recursive: true });
    // All FOUR real paths: skip / pass / husk-warn / crash-warn.
    const rows = [
      await checkEstate({ registry: {}, wtRoots: [] }),
      await checkEstate(seams(repo)),
      await checkEstate(seams(huskRepo)),
      await checkEstate({ ...seams(repo), registry: { bad: null } as never }),
    ];
    expect(rows.map((r) => r.status)).toEqual(['skip', 'pass', 'warn', 'warn']);
    expect(rows[2]!.message).toContain('husk candidate(s)');
    for (const row of rows) expect(row.gateExempt).toBe(true);
    expect(doctorGateFailed(rows, 'warn')).toBe(false);
  });
});

// ─── Secrets file tracking check ────────────────────────

describe('checkSecretsFileTracked', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('fails if secrets.json is tracked by git', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    // Create and track .totem/secrets.json
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'secrets.json'), JSON.stringify({ secrets: [] }));
    execSync('git add .totem/secrets.json', { cwd: tmpDir, stdio: 'ignore' });

    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.name).toBe('Secrets File Security');
    expect(result.message).toContain('tracked by git');
    expect(result.remediation).toContain('git rm --cached');
  });

  it('passes if secrets.json is not tracked', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('not tracked');
  });

  it('passes when not in a git repo', () => {
    // tmpDir is not a git repo — execSync will throw, which we catch
    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── AGENTS.md canonical redirect check (Proposal 272 § 6.7 / #1905) ──

describe('checkAgentsMdCanonical', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function makeProjectRoot(): void {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"fixture"}');
  }

  function canonicalRedirect(repoSlug = 'mmnto-ai/fixture'): string {
    return [
      '# Fixture: Claude Code Entry Point',
      '',
      'The canonical agent instructions for this repository live in [`AGENTS.md`](AGENTS.md).',
      '',
      `Per [Totem ADR-038 "AGENTS.md Standard Adoption"](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-038-agents-md-standard.md), \`${repoSlug}\` uses a single \`AGENTS.md\` as the source of truth for how all AI coding agents (Claude Code, Gemini CLI, Cursor, etc.) should behave here. This file exists only so Claude Code finds its way to \`AGENTS.md\`.`,
      '',
      'Read `AGENTS.md` before doing anything else.',
      '',
    ].join('\n');
  }

  it('skips non-project directories', () => {
    // No package.json, no .git
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('not a project root');
  });

  it('passes when CLAUDE.md is absent', () => {
    makeProjectRoot();
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no CLAUDE.md');
  });

  it('passes for a canonical cohort redirect (under threshold)', () => {
    makeProjectRoot();
    const redirect = canonicalRedirect();
    expect(Buffer.byteLength(redirect, 'utf-8')).toBeLessThanOrEqual(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), redirect);
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'canonical');

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('redirect');
  });

  it('fails when CLAUDE.md is fat and does not match the redirect pattern', () => {
    makeProjectRoot();
    const fat = `# Project Rules\n\n${'Some load-bearing rule that should live in AGENTS.md. '.repeat(20)}`;
    expect(Buffer.byteLength(fat, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), fat);

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not a redirect');
    expect(result.remediation).toContain('AGENTS.md');
  });

  it('passes for a verbose redirect (over threshold but matches pattern) with AGENTS.md present', () => {
    makeProjectRoot();
    // Pad the redirect with an extra paragraph above the threshold while
    // keeping the canonical phrase + link intact.
    const verbose =
      canonicalRedirect() +
      '\n\n## Local addendum\n\n' +
      'Long-form addendum for a downstream consumer that needs vendor-specific notes. '.repeat(4);
    expect(Buffer.byteLength(verbose, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), verbose);
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'canonical');

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('verbose redirect');
  });

  it('fails when CLAUDE.md is a verbose redirect but AGENTS.md is missing', () => {
    makeProjectRoot();
    const verbose =
      canonicalRedirect() +
      '\n\n## Addendum\n\n' +
      'Long-form addendum for a downstream consumer. '.repeat(8);
    expect(Buffer.byteLength(verbose, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), verbose);
    // No AGENTS.md

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('AGENTS.md does not exist');
    expect(result.remediation).toContain('Create AGENTS.md');
  });

  it('fails when a small CLAUDE.md matches the redirect pattern but AGENTS.md is missing', () => {
    // Defends against the template-copied-but-AGENTS.md-not-authored case.
    // The AGENTS.md existence requirement is independent of file size.
    makeProjectRoot();
    const redirect = canonicalRedirect();
    expect(Buffer.byteLength(redirect, 'utf-8')).toBeLessThanOrEqual(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), redirect);
    // No AGENTS.md — the test surface

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('AGENTS.md does not exist');
  });

  it('recognizes a bare .git directory as a project root', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    // No package.json, no CLAUDE.md — should pass (nothing to enforce)
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no CLAUDE.md');
  });

  it('redirect pattern is case-insensitive on the canonical phrase', () => {
    expect(
      AGENTS_MD_REDIRECT_PATTERN.test(
        'The Canonical Agent Instructions for this repository live in [`AGENTS.md`](AGENTS.md).',
      ),
    ).toBe(true);
  });

  it('redirect pattern rejects content that mentions AGENTS.md without the canonical delegation phrase', () => {
    expect(AGENTS_MD_REDIRECT_PATTERN.test('See [`AGENTS.md`](AGENTS.md) for more info.')).toBe(
      false,
    );
  });
});

// ─── Custom secret scanning ────────────────────────────

describe('checkSecretLeaks with custom secrets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('detects custom literal secrets in lesson files', async () => {
    // Create a custom secrets.json with a literal pattern
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'literal', value: 'SUPER_SECRET_TOKEN_1234' }],
      }),
    );

    // Create a lesson file that contains the literal secret
    fs.writeFileSync(
      path.join(lessonsDir, 'leaked-lesson.md'),
      '# Lesson\nDo not use SUPER_SECRET_TOKEN_1234 in production.',
    );

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('detects custom regex pattern secrets in lesson files', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'pattern', value: 'CORP-[A-Z0-9]{10,}' }],
      }),
    );

    fs.writeFileSync(
      path.join(lessonsDir, 'corp-leak.md'),
      '# Lesson\nFound token: CORP-ABCDEF1234567890',
    );

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('passes when custom secrets do not match any files', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'literal', value: 'UNIQUE_SECRET_WONT_MATCH' }],
      }),
    );

    fs.writeFileSync(path.join(lessonsDir, 'clean-lesson.md'), '# Lesson\nNothing sensitive here.');

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── Upgrade-candidate helpers (#1131) ─────────────────

interface UpgradeMetricInput {
  triggerCount?: number;
  suppressCount?: number;
  contextCounts?: {
    code?: number;
    string?: number;
    comment?: number;
    regex?: number;
    unknown?: number;
  };
}

function writeUpgradeMetrics(totemDir: string, rules: Record<string, UpgradeMetricInput>): void {
  const cacheDir = path.join(totemDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const [hash, m] of Object.entries(rules)) {
    const entry: Record<string, unknown> = {
      triggerCount: m.triggerCount ?? 0,
      suppressCount: m.suppressCount ?? 0,
      lastTriggeredAt: '2026-04-06T12:00:00.000Z',
      lastSuppressedAt: null,
    };
    if (m.contextCounts) {
      entry.contextCounts = {
        code: m.contextCounts.code ?? 0,
        string: m.contextCounts.string ?? 0,
        comment: m.contextCounts.comment ?? 0,
        regex: m.contextCounts.regex ?? 0,
        unknown: m.contextCounts.unknown ?? 0,
      };
    }
    out[hash] = entry;
  }
  fs.writeFileSync(
    path.join(cacheDir, 'rule-metrics.json'),
    JSON.stringify({ version: 1, rules: out }, null, 2) + '\n',
    'utf-8',
  );
}

interface UpgradeRuleInput {
  lessonHash: string;
  lessonHeading?: string;
  /** Override to produce a manual-rule shape (lessonHeading === message). */
  message?: string;
  /** Set true to mark rule as Pipeline 1 manual (#1265) — preferred over heading=message heuristic. */
  manual?: boolean;
  engine?: 'regex' | 'ast' | 'ast-grep';
  pattern?: string;
  astQuery?: string;
  astGrepPattern?: string;
}

function writeUpgradeRules(totemDir: string, rules: UpgradeRuleInput[]): void {
  fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify(
      {
        version: 1,
        rules: rules.map((r) => {
          const engine = r.engine ?? 'regex';
          const base = {
            lessonHash: r.lessonHash,
            lessonHeading: r.lessonHeading ?? r.lessonHash,
            message: r.message ?? `Violation: ${r.lessonHeading ?? r.lessonHash}`,
            engine,
            compiledAt: '2026-04-06T12:00:00.000Z',
            ...(r.manual === true ? { manual: true } : {}),
          };
          if (engine === 'regex') {
            return { ...base, pattern: r.pattern ?? '\\bconsole\\.log\\b' };
          }
          if (engine === 'ast') {
            return {
              ...base,
              pattern: '',
              astQuery: r.astQuery ?? '(call_expression) @violation',
            };
          }
          // ast-grep
          return {
            ...base,
            pattern: '',
            astGrepPattern: r.astGrepPattern ?? 'console.log($ARG)',
          };
        }),
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

// ─── checkUpgradeCandidates (#1131) ────────────────────

describe('checkUpgradeCandidates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('exposes the constants that govern flagging', () => {
    expect(NON_CODE_THRESHOLD).toBe(0.2);
    expect(MIN_CONTEXT_EVENTS).toBe(5);
  });

  it('skips when compiled-rules.json is missing', async () => {
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('missing');
  });

  it('passes when no metrics exist', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'rule-empty', lessonHeading: 'Empty rule' }]);
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('flags a rule with 40% non-code matches (3 code + 2 string)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'noisy-rule', lessonHeading: 'Noisy regex' }]);
    writeUpgradeMetrics(totemDir, {
      'noisy-rule': {
        triggerCount: 5,
        contextCounts: { code: 3, string: 2 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('noisy-rule');
    expect(result.message).toContain('40%');
    expect(result.remediation).toContain('totem lesson compile --upgrade noisy-rule');
  });

  it('does NOT flag a rule at exactly 20% non-code (strict greater-than)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'boundary-rule', lessonHeading: 'Boundary' }]);
    writeUpgradeMetrics(totemDir, {
      'boundary-rule': {
        triggerCount: 5,
        // 4 code + 1 string = 5 total, 1/5 = 20% non-code (NOT > 20%)
        contextCounts: { code: 4, string: 1 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips rules with fewer than MIN_CONTEXT_EVENTS total matches', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'low-volume', lessonHeading: 'Low volume rule' }]);
    writeUpgradeMetrics(totemDir, {
      'low-volume': {
        triggerCount: 4,
        // 100% non-code, but only 4 events → below MIN_CONTEXT_EVENTS
        contextCounts: { code: 0, string: 4 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips ast-grep rules regardless of telemetry', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'astgrep-rule',
        lessonHeading: 'Already structural',
        engine: 'ast-grep',
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'astgrep-rule': {
        triggerCount: 10,
        contextCounts: { code: 1, string: 9 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips rules without contextCounts telemetry silently', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'no-telemetry', lessonHeading: 'No telemetry' }]);
    writeUpgradeMetrics(totemDir, {
      'no-telemetry': {
        triggerCount: 100,
        // No contextCounts at all (legacy metric)
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips legacy ast-engine rules because their telemetry lands in unknown', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      { lessonHash: 'ast-noisy', lessonHeading: 'Noisy AST', engine: 'ast' },
    ]);
    writeUpgradeMetrics(totemDir, {
      'ast-noisy': {
        triggerCount: 10,
        contextCounts: { code: 2, comment: 8 },
      },
    });

    // Legacy `ast` (Tree-sitter) rules do not populate `astContext`, so their
    // context distribution is not trustworthy. checkUpgradeCandidates scopes to
    // `engine === 'regex'` only.
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips manual regex rules (message === lessonHeading) — legacy heuristic', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    // Pre-#1265 manual rule: message === lessonHeading. This was the only signal
    // available for identifying Pipeline 1 rules before the explicit `manual: true`
    // flag landed. Old compiled-rules.json files don't have the flag, so the doctor
    // must continue to support this heuristic for backward compatibility.
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'manual-rule',
        lessonHeading: 'No console.log',
        message: 'No console.log',
        engine: 'regex',
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'manual-rule': {
        triggerCount: 20,
        contextCounts: { code: 2, string: 18, comment: 0, regex: 0, unknown: 0 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips manual regex rules with rich messages via the manual flag (#1265)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    // Post-#1265 manual rule: message DIFFERS from lessonHeading because Pipeline 1
    // now supports a **Message:** field. The legacy heading=message heuristic would
    // FAIL to skip this rule, but the explicit `manual: true` flag set by
    // buildManualRule provides a reliable signal. Without this fix, doctor would
    // try to upgrade the rule via Pipeline 2, burning LLM cycles to produce the
    // same hand-written manual pattern that takes Pipeline 1 priority on next compile.
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'manual-rule-with-message',
        lessonHeading: 'No console.log',
        message:
          'Use the structured logger (logger.info) instead of console.log so production output stays filterable.',
        engine: 'regex',
        manual: true,
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'manual-rule-with-message': {
        triggerCount: 20,
        contextCounts: { code: 2, string: 18, comment: 0, regex: 0, unknown: 0 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips the unknown bucket when computing non-code ratio', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      { lessonHash: 'mostly-historical', lessonHeading: 'Historical', engine: 'regex' },
    ]);
    writeUpgradeMetrics(totemDir, {
      'mostly-historical': {
        triggerCount: 100,
        // 100 historical hits + 5 recent classified: 5 code, 0 non-code.
        // Old math: (0 + 100) / 105 = 95% "non-code" → false positive.
        // New math: 0 / 5 = 0% → pass.
        contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 100 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── Self-healing helpers ───────────────────────────────

function makeLedgerEvent(ruleId: string, type: 'suppress' | 'override' = 'suppress'): string {
  return JSON.stringify({
    timestamp: '2026-03-25T12:00:00.000Z',
    type,
    ruleId,
    file: 'src/index.ts',
    justification: type === 'override' ? 'Legacy code' : '',
    source: 'lint',
  });
}

function writeLedger(totemDir: string, lines: string[]): void {
  const ledgerDir = path.join(totemDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'events.ndjson'), lines.join('\n') + '\n', 'utf-8');
}

function writeMetrics(
  totemDir: string,
  rules: Record<string, { triggerCount: number; suppressCount: number }>,
): void {
  const cacheDir = path.join(totemDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const metricsData = {
    version: 1,
    rules: Object.fromEntries(
      Object.entries(rules).map(([id, counts]) => [
        id,
        {
          triggerCount: counts.triggerCount,
          suppressCount: counts.suppressCount,
          lastTriggeredAt: '2026-03-25T12:00:00.000Z',
          lastSuppressedAt: null,
        },
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(cacheDir, 'rule-metrics.json'),
    JSON.stringify(metricsData, null, 2) + '\n',
    'utf-8',
  );
}

function makeCompiledRules(
  rules: Array<{
    lessonHash: string;
    lessonHeading: string;
    severity?: string;
    pattern?: string;
  }>,
): object {
  return {
    version: 1,
    rules: rules.map((r) => ({
      lessonHash: r.lessonHash,
      lessonHeading: r.lessonHeading,
      pattern: r.pattern ?? '\\bconsole\\.log\\b',
      message: `Violation: ${r.lessonHeading}`,
      engine: 'regex',
      compiledAt: '2026-03-25T12:00:00.000Z',
      ...(r.severity !== undefined ? { severity: r.severity } : {}),
    })),
  };
}

/**
 * Set up a minimal workspace for self-healing tests.
 * Returns the totemDir path (.totem inside cwd).
 */
function setupSelfHealingWorkspace(cwd: string): string {
  // Config file so resolveConfigPath succeeds (targets needs at least one entry)
  const config = {
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    totemDir: '.totem',
  };
  fs.writeFileSync(
    path.join(cwd, 'totem.yaml'),
    `targets:\n  - glob: "${config.targets[0].glob}"\n    type: ${config.targets[0].type}\n    strategy: ${config.targets[0].strategy}\ntotemDir: .totem\n`,
    'utf-8',
  );

  const totemDir = path.join(cwd, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  return totemDir;
}

// ─── Self-healing (runSelfHealing) ──────────────────────

describe('runSelfHealing', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Init a git repo so the git status check doesn't fail
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    // Configure git user for CI environments where global config is missing
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });

    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    stderrSpy.mockRestore();
  });

  it('reports no data when ledger is empty', async () => {
    setupSelfHealingWorkspace(tmpDir);

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No ledger data');
  });

  it('reports healthy when no rules exceed threshold', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 1 bypass out of 10 total = 10% < 30% threshold
    writeLedger(totemDir, [makeLedgerEvent('rule-a')]);
    writeMetrics(totemDir, {
      'rule-a': { triggerCount: 9, suppressCount: 1 },
    });

    // Write compiled rules so the file exists
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-a', lessonHeading: 'Healthy rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No rules exceed the 30% bypass threshold');
  });

  it('downgrades rules exceeding 30% bypass rate', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 4 bypasses + 3 triggers = 7 total, rate = 4/7 ≈ 57%
    writeLedger(totemDir, [
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
    ]);
    writeMetrics(totemDir, {
      'rule-noisy': { triggerCount: 3, suppressCount: 4 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-noisy', lessonHeading: 'Noisy Rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit the rules file so git status --porcelain is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    // After runSelfHealing, it switches back to the original branch via `git checkout -`.
    // The downgraded file lives on the auto-downgrade branch.
    // Verify the downgrade through console output and the branch's committed content.
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Noisy Rule');
    expect(output).toContain('Downgraded 1 rule(s)');

    // Find the auto-downgrade branch and verify the committed file
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf-8' });
    expect(branches).toContain('totem/auto-healing-');

    // Check the committed file on the branch
    const branchName = branches
      .split('\n')
      .map((b: string) => b.trim())
      .find((b: string) => b.startsWith('totem/auto-healing-'));
    expect(branchName).toBeDefined();

    const showResult = spawnSync('git', ['show', `${branchName}:.totem/compiled-rules.json`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const committedContent = showResult.stdout ?? '';
    const committedRules = JSON.parse(committedContent);
    expect(committedRules.rules[0].severity).toBe('warning');
  });

  it('skips rules with fewer than MIN_EVENTS total events', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 2 bypasses + 1 trigger = 3 total events < MIN_EVENTS (5)
    // bypass rate = 2/3 ≈ 67% — exceeds threshold but too few events
    writeLedger(totemDir, [makeLedgerEvent('rule-tiny'), makeLedgerEvent('rule-tiny')]);
    writeMetrics(totemDir, {
      'rule-tiny': { triggerCount: 1, suppressCount: 2 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-tiny', lessonHeading: 'Tiny Sample Rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    await runSelfHealing(tmpDir);

    // Rule should NOT be downgraded — still at error severity
    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('error');

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No rules exceed the 30% bypass threshold');
  });

  it('skips rules already at warning severity', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 4 bypasses + 2 triggers = 6 total, rate = 4/6 ≈ 67%
    writeLedger(totemDir, [
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
    ]);
    writeMetrics(totemDir, {
      'rule-warn': { triggerCount: 2, suppressCount: 4 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-warn', lessonHeading: 'Already Warning', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so git status is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    // Rule should remain at warning — not modified
    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('warning');

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('already at warning');
  });

  it('exports constants for testing', () => {
    expect(BYPASS_THRESHOLD).toBe(0.3);
    expect(MIN_EVENTS).toBe(5);
  });

  it('runs the upgrade phase without crashing when no candidates exist (mmnto/totem#1131)', async () => {
    // No metrics → no candidates → upgrade phase should print "no rules flagged"
    const totemDir = setupSelfHealingWorkspace(tmpDir);
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-clean', lessonHeading: 'Clean rule', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so the working tree is clean (upgrade phase is skipped via gitDirty guard)
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Checking for ast-grep upgrade candidates');
    expect(output).toContain('No rules flagged for upgrade');
  });

  it('detects upgrade candidates and reports them in the upgrade phase (mmnto/totem#1131)', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // Write a regex rule with telemetry showing 60% non-code matches
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'noisy-regex', lessonHeading: 'Noisy regex rule', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    const cacheDir = path.join(totemDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'rule-metrics.json'),
      JSON.stringify(
        {
          version: 1,
          rules: {
            'noisy-regex': {
              triggerCount: 10,
              suppressCount: 0,
              lastTriggeredAt: '2026-04-06T12:00:00.000Z',
              lastSuppressedAt: null,
              contextCounts: { code: 4, string: 6, comment: 0, regex: 0, unknown: 0 },
            },
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so the working tree is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    // The phase should detect the candidate and attempt to upgrade it.
    // The actual `pnpm exec totem compile --upgrade` call will likely fail in the test
    // sandbox (no orchestrator config / no LLM) — that's expected. We're just verifying
    // the candidate was detected and the phase ran end-to-end.
    expect(output).toContain('Checking for ast-grep upgrade candidates');
    expect(output).toContain('Found 1 upgrade candidate');
  });

  it('archives stale rules with zero triggers during self-healing', async () => {
    // Set up workspace with GC enabled
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });

    // Config with garbageCollection enabled
    fs.writeFileSync(
      path.join(tmpDir, 'totem.yaml'),
      [
        'targets:',
        '  - glob: "**/*.ts"',
        '    type: code',
        '    strategy: typescript-ast',
        'totemDir: .totem',
        'garbageCollection:',
        '  enabled: true',
        '  minAgeDays: 90',
        '  exemptCategories:',
        '    - security',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Create an old rule (compiledAt 120 days ago)
    const oldDate = new Date('2026-03-30T00:00:00.000Z');
    oldDate.setDate(oldDate.getDate() - 120);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          version: 1,
          rules: [
            {
              lessonHash: 'stale-rule',
              lessonHeading: 'Stale Rule',
              pattern: '\\bconsole\\.log\\b',
              message: 'Violation: Stale Rule',
              engine: 'regex',
              compiledAt: oldDate.toISOString(),
              status: 'active',
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Write metrics with zero activity for the rule
    writeMetrics(totemDir, {
      'stale-rule': { triggerCount: 0, suppressCount: 0 },
    });

    // Commit so git status is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Archived 1 stale rule(s)');

    // Verify the rule was archived — the function switches back to original branch,
    // but the GC changes are committed on a healing branch.
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf-8' });
    const healingBranch = branches
      .split('\n')
      .map((b: string) => b.trim())
      .find((b: string) => b.startsWith('totem/auto-healing-'));
    expect(healingBranch).toBeDefined();

    // Verify committed file on the branch
    const showResult = spawnSync('git', ['show', `${healingBranch}:.totem/compiled-rules.json`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const committedRules = JSON.parse(showResult.stdout ?? '');
    expect(committedRules.rules[0].status).toBe('archived');
    expect(committedRules.rules[0].archivedReason).toMatch(/after \d+ days/);
  });
});

// ─── Linked indexes health check (#1308) ────────────────

describe('checkLinkedIndexes (#1308)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns skip when no linkedIndexes configured', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
};`,
    );
    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.name).toBe('Linked Indexes');
  });

  it('returns skip when host has no embedding provider', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  linkedIndexes: ['../other-repo'],
};`,
    );
    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('Lite tier');
  });

  it('returns pass when linked index is reachable', () => {
    const linkedDir = makeTmpDir();
    try {
      // Set up the linked repo with a config and .lancedb
      fs.writeFileSync(
        path.join(linkedDir, 'totem.config.ts'),
        `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
};`,
      );
      const lanceDir = path.join(linkedDir, '.lancedb');
      fs.mkdirSync(lanceDir, { recursive: true });
      fs.writeFileSync(path.join(lanceDir, 'data.lance'), 'placeholder');

      // Escape backslashes for Windows paths in the config template
      const escapedPath = linkedDir.replace(/\\/g, '\\\\');
      fs.writeFileSync(
        path.join(tmpDir, 'totem.config.ts'),
        `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
  linkedIndexes: ['${escapedPath}'],
};`,
      );

      const result = checkLinkedIndexes(tmpDir);
      expect(result.status).toBe('pass');
      expect(result.name).toBe('Linked Indexes');
      expect(result.message).toContain('1 configured');
      expect(result.message).toContain('1 reachable');
    } finally {
      cleanTmpDir(linkedDir);
    }
  });

  it('returns warn when linked index path does not exist', () => {
    const nonExistentPath = path.join(tmpDir, 'no-such-repo');
    const escapedPath = nonExistentPath.replace(/\\/g, '\\\\');
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
  linkedIndexes: ['${escapedPath}'],
};`,
    );

    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.name).toBe('Linked Indexes');
    expect(result.remediation).toContain('does not exist');
  });
});

// ─── Strategy root (mmnto-ai/totem#1710) ──────────────────

describe('checkStrategyRoot (mmnto-ai/totem#1710)', () => {
  let tmpDir: string;
  let prevEnvPrimary: string | undefined;
  let prevEnvAlias: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    prevEnvPrimary = process.env.TOTEM_STRATEGY_ROOT;
    prevEnvAlias = process.env.STRATEGY_ROOT;
    delete process.env.TOTEM_STRATEGY_ROOT;
    delete process.env.STRATEGY_ROOT;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    // Symmetric restore: when prev was undefined, the env var was unset
    // before this suite ran — DELETE rather than leak the test's value.
    if (prevEnvPrimary === undefined) delete process.env.TOTEM_STRATEGY_ROOT;
    else process.env.TOTEM_STRATEGY_ROOT = prevEnvPrimary;
    if (prevEnvAlias === undefined) delete process.env.STRATEGY_ROOT;
    else process.env.STRATEGY_ROOT = prevEnvAlias;
  });

  it('returns warn (NOT fail) when no strategy root resolves', async () => {
    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.name).toBe('Strategy Root');
    expect(result.remediation).toMatch(/describe_project|proposal|federated/);
  });

  it('returns pass when TOTEM_STRATEGY_ROOT points to a real directory', async () => {
    const target = path.join(tmpDir, 'elsewhere');
    fs.mkdirSync(target, { recursive: true });
    process.env.TOTEM_STRATEGY_ROOT = target;

    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Strategy Root');
    expect(result.message).toMatch(/^env →/);
  });

  it('strips ANSI/CR/newline/tab control bytes from diagnostic strings (R4/R6 — terminal injection)', async () => {
    // Hostile env value with embedded ANSI + CR + newlines + tabs.
    // Without sanitization the unresolved-path diagnostic would echo
    // these bytes through `log.warn` and rewind the cursor / spoof colors
    // when `totem doctor` rendered it. R6 also flattens \n/\t to prevent
    // forged extra log lines (`sanitizeForTerminal` deliberately preserves
    // \n/\t for multi-line content; the doctor caller flattens).
    process.env.TOTEM_STRATEGY_ROOT = `${tmpDir}/missing\x1b[31mEVIL\x1b[0m\r\n\n[fake] OK\tTAB`;

    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('warn');
    // Message itself is the static string — the env value flows into
    // `remediation` via `status.reason`.
    expect(result.remediation).toBeDefined();
    expect(result.remediation).not.toMatch(/\x1b\[/);
    expect(result.remediation).not.toMatch(/\r/);
    expect(result.remediation).not.toMatch(/\n/);
    expect(result.remediation).not.toMatch(/\t/);
  });
});

// ─── Stale rules (mmnto-ai/totem#1483) ──────────────────

describe('findStaleRules + checkStaleRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // Seed a 5-rule fixture exercising every branch of findStaleRules:
  //   A: fresh (evaluationCount < window) — should be ignored
  //   B: stale standard (evaluationCount >= window, 0 code hits) — flagged warn
  //   C: stale security via category=security — flagged severe
  //   D: healthy (evaluationCount >= window, code hits > 0) — ignored
  //   E: stale security via immutable=true (no category) — flagged severe
  function seedFixture(tmpDir: string, options: { window: number } = { window: 10 }): void {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });

    const compiledRulesFile = {
      version: 1,
      rules: [
        {
          lessonHash: 'rule-A-fresh',
          lessonHeading: 'Rule A (fresh)',
          pattern: 'foo',
          message: 'A',
          engine: 'regex',
          compiledAt: '2026-04-01T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-B-stale',
          lessonHeading: 'Rule B (stale standard)',
          pattern: 'bar',
          message: 'B',
          engine: 'regex',
          compiledAt: '2026-03-01T00:00:00.000Z',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-C-stale-security',
          lessonHeading: 'Rule C (stale security)',
          pattern: 'baz',
          message: 'C',
          engine: 'regex',
          compiledAt: '2026-02-01T00:00:00.000Z',
          createdAt: '2026-02-01T00:00:00.000Z',
          category: 'security' as const,
        },
        {
          lessonHash: 'rule-D-healthy',
          lessonHeading: 'Rule D (healthy)',
          pattern: 'qux',
          message: 'D',
          engine: 'regex',
          compiledAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-E-stale-immutable',
          lessonHeading: 'Rule E (stale immutable)',
          pattern: 'zot',
          message: 'E',
          engine: 'regex',
          compiledAt: '2026-02-15T00:00:00.000Z',
          createdAt: '2026-02-15T00:00:00.000Z',
          immutable: true,
        },
      ],
      nonCompilable: [],
    };
    fs.writeFileSync(path.join(totemDir, 'compiled-rules.json'), JSON.stringify(compiledRulesFile));

    const metricsFile = {
      version: 1,
      rules: {
        'rule-A-fresh': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: Math.max(0, options.window - 1),
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-B-stale': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 5,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-C-stale-security': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 2,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-D-healthy': {
          triggerCount: 5,
          suppressCount: 0,
          lastTriggeredAt: '2026-03-15T00:00:00.000Z',
          lastSuppressedAt: null,
          evaluationCount: options.window + 5,
          contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-E-stale-immutable': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 3,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
      },
    };
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify(metricsFile),
    );
  }

  it('returns null when compiled-rules.json is missing', async () => {
    const result = await findStaleRules(tmpDir);
    expect(result).toBeNull();
  });

  it('flags stale standard and stale security rules; ignores fresh + healthy', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    expect(result).not.toBeNull();
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toContain('rule-B-stale');
    expect(hashes).toContain('rule-C-stale-security');
    expect(hashes).toContain('rule-E-stale-immutable');
    expect(hashes).not.toContain('rule-A-fresh');
    expect(hashes).not.toContain('rule-D-healthy');
  });

  it('assigns severity "security" to category=security and immutable=true rules, ordering them first', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    expect(result).not.toBeNull();
    // Both security rules come before any standard rule. Among the two
    // security rules, E (evaluationCount 13) sorts ahead of C (12) by the
    // evaluationCount-desc tiebreaker.
    expect(result![0]!.lessonHash).toBe('rule-E-stale-immutable');
    expect(result![0]!.severity).toBe('security');
    expect(result![0]!.flags.immutable).toBe(true);
    expect(result![1]!.lessonHash).toBe('rule-C-stale-security');
    expect(result![1]!.severity).toBe('security');
    expect(result![1]!.flags.category).toBe('security');
    expect(result![2]!.lessonHash).toBe('rule-B-stale');
    expect(result![2]!.severity).toBe('standard');
  });

  it('never recommends archival for security rules (category=security or immutable=true)', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const securityRules = result!.filter((c) => c.severity === 'security');
    expect(securityRules.length).toBe(2);
    for (const security of securityRules) {
      expect(security.recommendation).not.toContain('archived');
      expect(security.recommendation).toContain('Do not archive');
      expect(security.recommendation).toContain('totem compile --upgrade');
    }
  });

  it('recommends either upgrade or archive for standard stale rules', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const standard = result!.find((c) => c.severity === 'standard')!;
    expect(standard.recommendation).toContain('totem compile --upgrade');
    expect(standard.recommendation).toContain('archived');
  });

  it('respects a custom staleRuleWindow threshold passed through the call', async () => {
    // Rule B has evaluationCount 15, Rule C has 12, Rule E has 13. Push the
    // window up to 14 so only Rule B qualifies.
    seedFixture(tmpDir, { window: 10 });
    const result = await findStaleRules(tmpDir, '.totem', { staleRuleWindow: 14 });
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-B-stale']);
  });

  it('flags rules whose evaluationCount exactly equals staleRuleWindow', async () => {
    // Boundary test for the >= semantics at the staleness check site. A rule
    // with evaluationCount === staleRuleWindow and zero code hits must flag.
    // Guards against an off-by-one regression that would flip the check to >.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-boundary',
            lessonHeading: 'exact window',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-boundary': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 10,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir, '.totem', { staleRuleWindow: 10 });
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-boundary']);
  });

  it('never flags rules below staleRuleWindow regardless of zero hits', async () => {
    // Seed a fresh rule with evaluationCount = 0 explicitly; should never
    // flag even after infinite runs.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-zero',
            lessonHeading: 'zero',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-zero': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 0,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips archived rules', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-archived',
            lessonHeading: 'already archived',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'archived',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-archived': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 100,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('checkStaleRules returns pass when no rules are stale', async () => {
    // Only seed a healthy rule.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-healthy',
            lessonHeading: 'healthy',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-healthy': {
            triggerCount: 5,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 20,
            contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('checkStaleRules returns warn with candidate details when stale rules exist', async () => {
    seedFixture(tmpDir);
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('warn');
    // Structured count check: seedFixture produces 2 security + 1 standard
    // stale rule. Match explicit "N security" / "N standard" phrasing so a
    // renderer change that drops the category split fails loud rather than
    // passing on any digit that happens to appear anywhere in the message.
    expect(result.message).toMatch(/\b2\s+security\b/i);
    expect(result.message).toMatch(/\b1\s+standard\b/i);
    expect(result.remediation).toContain('totem compile --upgrade');
  });

  it('checkStaleRules returns skip when compiled-rules.json is missing', async () => {
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('skip');
  });
});

// ─── Grandfathered rules (mmnto-ai/totem#1603) ──────────

describe('findLegacyGrandfatheredRules + checkGrandfatheredRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function writeRules(tmpDir: string, rules: unknown[]): void {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules, nonCompilable: [] }),
    );
  }

  // Post-1.13.0 timestamp used to neutralize the vintage reason in tests
  // that target a single reason code in isolation.
  const POST_1_13_0 = '2026-04-08T00:00:00.000Z';
  const PRE_1_13_0 = '2026-02-01T00:00:00.000Z';

  it('returns null when compiled-rules.json is missing', async () => {
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toBeNull();
  });

  it('flags a rule for vintage-pre-1.13.0 in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-vintage',
        lessonHeading: 'vintage only',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        badExample: 'bad snippet',
        goodExample: 'good snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-vintage',
        reasons: ['vintage-pre-1.13.0'],
      }),
    ]);
  });

  it('flags a rule for no-badExample in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-bad',
        lessonHeading: 'missing bad',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        goodExample: 'good snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-no-bad',
        reasons: ['no-badExample'],
      }),
    ]);
  });

  // ── Prop 310 § Design 10 (slice 3) — the record rule's exemplar home ──
  it('flags NEITHER reason for a RECORD rule — both exemplar sides live in `examples`', async () => {
    // A record rule's exemplars are the § Design 10 editable home for BOTH sides
    // and are never mirrored onto the legacy `badExample`/`goodExample`, so the
    // shipped reads would have called every record rule grandfathered. Note it
    // carries NEITHER legacy field: reading `examples` for one side and the legacy
    // field for the other would clear one reason and raise the other on the very
    // same absence (MIN-5).
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-record',
        lessonHeading: 'Prop 310 rule record (rule-record)',
        pattern: 'console\\.log',
        message: 'no console.log',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        examples: [{ bad: 'console.log(1)', good: 'logger.info(1)' }],
      },
    ]);
    expect(await findLegacyGrandfatheredRules(tmpDir)).toEqual([]);
  });

  it('STILL flags no-goodExample for a legacy rule with a whitespace-only goodExample', async () => {
    // The byte-identity control for the postimage reader swap, mirroring the
    // badExample row below it.
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-blank-good',
        lessonHeading: 'blank good',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad snippet',
        goodExample: ' \n\t ',
      },
    ]);
    expect(await findLegacyGrandfatheredRules(tmpDir)).toEqual([
      expect.objectContaining({ lessonHash: 'rule-blank-good', reasons: ['no-goodExample'] }),
    ]);
  });

  it('STILL flags no-badExample for a legacy rule with a whitespace-only badExample', async () => {
    // The byte-identity control for the reader swap: dropping blank lines is what
    // keeps `.length === 0` equal to the shipped `!badExample || trim() === ''`.
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-blank-bad',
        lessonHeading: 'blank bad',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: '   \n\t',
        goodExample: 'good snippet',
      },
    ]);
    expect(await findLegacyGrandfatheredRules(tmpDir)).toEqual([
      expect.objectContaining({ lessonHash: 'rule-blank-bad', reasons: ['no-badExample'] }),
    ]);
  });

  it('flags a rule for no-goodExample in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-good',
        lessonHeading: 'missing good',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-no-good',
        reasons: ['no-goodExample'],
      }),
    ]);
  });

  it('treats whitespace-only substrate snippets as absent', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-whitespace',
        lessonHeading: 'whitespace snippets',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: '   ',
        goodExample: '\n\t',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons.sort()).toEqual(['no-badExample', 'no-goodExample']);
  });

  it('aggregates multiple reasons on a single rule', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-all-three',
        lessonHeading: 'full legacy',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons).toEqual(['vintage-pre-1.13.0', 'no-badExample', 'no-goodExample']);
  });

  it('skips archived rules', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-archived',
        lessonHeading: 'archived legacy',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        status: 'archived',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips rules with unverified: true (post zero-trust cohort)', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-unverified',
        lessonHeading: 'zero-trust marker present',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        unverified: true,
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('omits rules that satisfy all three substrate checks', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-substrate-complete',
        lessonHeading: 'fully verified',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('treats vintage at the exact 1.13.0 ship date as NOT pre-1.13.0', async () => {
    // Boundary test: `<` semantics, not `<=`. A rule whose createdAt equals
    // V_1_13_0_SHIP_DATE_ISO shipped with 1.13.0 and carries the substrate
    // expectation forward, so it does not count as vintage.
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-at-boundary',
        lessonHeading: 'boundary',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: V_1_13_0_SHIP_DATE_ISO,
        createdAt: V_1_13_0_SHIP_DATE_ISO,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('falls back to compiledAt when createdAt is absent', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-createdat',
        lessonHeading: 'no createdAt',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons).toEqual(['vintage-pre-1.13.0']);
    expect(result![0]!.vintage).toBe(PRE_1_13_0);
  });

  it('sorts worst-off first, then oldest vintage first', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-one-reason-new',
        lessonHeading: 'one reason, newer vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
      },
      {
        lessonHash: 'rule-all-three-newer',
        lessonHeading: 'three reasons, newer vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: '2026-03-15T00:00:00.000Z',
        createdAt: '2026-03-15T00:00:00.000Z',
      },
      {
        lessonHash: 'rule-all-three-older',
        lessonHeading: 'three reasons, older vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-all-three-older', 'rule-all-three-newer', 'rule-one-reason-new']);
  });

  it('checkGrandfatheredRules returns skip when compiled-rules.json is missing', async () => {
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('skip');
  });

  it('checkGrandfatheredRules returns pass when no rules are grandfathered', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-verified',
        lessonHeading: 'verified',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('checkGrandfatheredRules returns warn with per-reason counts and ADR-091 remediation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-a',
        lessonHeading: 'A',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
      },
      {
        lessonHash: 'rule-b',
        lessonHeading: 'B',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
      },
    ]);
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/2 grandfathered rule\(s\)/);
    expect(result.message).toMatch(/1 vintage-pre-1\.13\.0/);
    expect(result.message).toMatch(/1 no-badExample/);
    expect(result.message).toMatch(/2 no-goodExample/);
    expect(result.remediation).toContain('ADR-091 Stage 4');
    expect(result.remediation).toContain('mmnto-ai/totem#1504');
  });
});

// ─── checkFreezes (#2167 — sensor-only freeze surfacing) ────────────────

describe('checkFreezes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-freeze-'));
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function installSnapshot(freeze: unknown): void {
    const pkgDir = path.join(tmpDir, 'node_modules', '@mmnto', 'strategy-doctrine');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@mmnto/strategy-doctrine', version: '0.2.0' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'freeze.json'),
      typeof freeze === 'string' ? freeze : JSON.stringify(freeze),
    );
  }

  it('passes with the not-adopted channel note when nothing is frozen anywhere', async () => {
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('No active freezes');
    expect(result.message).toContain('not adopted');
  });

  it('warns (never fails) with provenance tags when freezes are active', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'freeze.json'),
      JSON.stringify({ frozen: [{ subsystem: 'embedder', scope: 'local' }] }),
    );
    installSnapshot({
      frozen: [{ subsystem: 'rule-compilation (legacy)', id: 'rule-compilation', scope: 'cohort' }],
    });
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('"embedder" [local]');
    expect(result.message).toContain('[cohort@0.2.0]');
  });

  it('warns on a corrupt distributed snapshot — sensor-only, never a fail status', async () => {
    installSnapshot('{ not json');
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('CORRUPT');
  });

  it('warns (not fail) when the LOCAL freeze file is corrupt — doctor reports, the gate layer gates', async () => {
    fs.writeFileSync(path.join(tmpDir, '.totem', 'freeze.json'), '{ corrupt');
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('underivable');
  });
});

// ─── Estate row × wt-registry coupling (#2580 slice 2) ──

describe('checkEstate — wt-registry roots', () => {
  let estateHome: string;
  let prevHome: string | undefined;
  let prevProfile: string | undefined;

  beforeEach(() => {
    estateHome = fs.realpathSync(makeTmpDir());
    prevHome = process.env['HOME'];
    prevProfile = process.env['USERPROFILE'];
    process.env['HOME'] = estateHome;
    process.env['USERPROFILE'] = estateHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    cleanTmpDir(estateHome);
  });

  function writeWtRegistry(contents: string): void {
    fs.mkdirSync(path.join(estateHome, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(estateHome, '.totem', 'worktrees.json'), contents, 'utf-8');
  }

  // Invariant 8 on the AMBIENT row: the sensor row must sweep what `--estate`
  // sweeps, or a clean ambient line would contradict the explicit command.
  it('sweeps the recorded DEFAULT root with an EMPTY sync registry, finding the husk', async () => {
    // The default `~/.totem/worktrees` is the one recorded root that carries
    // container semantics — it exists solely to hold worktrees.
    const recorded = path.join(estateHome, '.totem', 'worktrees');
    fs.mkdirSync(path.join(recorded, 'left-behind'), { recursive: true });
    writeWtRegistry(JSON.stringify({ schemaVersion: 1, roots: [recorded], worktrees: {} }));

    const result = await checkEstate({ registry: {} });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('1 husk candidate(s)');
    expect(result.gateExempt).toBe(true);
  });

  it('sweeps a NON-default recorded root with shape evidence only — no by-location husks', async () => {
    // A recorded scratch root holds other things beside worktrees; an
    // arbitrary directory there is NOT residue-by-location (finding 11).
    const recorded = path.join(estateHome, 'scratch-root');
    fs.mkdirSync(path.join(recorded, 'unrelated-project'), { recursive: true });
    writeWtRegistry(JSON.stringify({ schemaVersion: 1, roots: [recorded], worktrees: {} }));

    const result = await checkEstate({ registry: {} });
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no stale worktrees or husk candidates');
  });

  it('surfaces the unreadable sync registry even when recorded roots keep the scan alive', async () => {
    // Finding 1: a live recorded root routes AROUND the empty-registry
    // short-circuit — the unreadable-registry disclosure must ride the live
    // row, never vanish into a clean pass.
    fs.mkdirSync(path.join(estateHome, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(estateHome, '.totem', 'registry.json'), '{ not json', 'utf-8');
    const recorded = path.join(estateHome, '.totem', 'worktrees');
    fs.mkdirSync(recorded, { recursive: true });
    writeWtRegistry(JSON.stringify({ schemaVersion: 1, roots: [recorded], worktrees: {} }));

    const result = await checkEstate({});
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Sync registry unreadable');
    // The scan itself still ran — the disclosure rides a live row, not a skip.
    expect(result.message).toContain('no stale worktrees or husk candidates');
    expect(result.remediation).toContain('registry.json');
    // Warning text is flattened at interpolation (bot round, CR finding 2):
    // a multi-line parse error must never forge extra doctor rows.
    expect(result.message).not.toContain('\n');
  });

  it('keeps the unreadable-registry disclosure when the scan itself throws', async () => {
    // Re-verification round 2, finding 4: the catch arm was the one row shape
    // that dropped the disclosure — broken sync registry AND a scan failure
    // must surface BOTH signals on the same row.
    fs.mkdirSync(path.join(estateHome, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(estateHome, '.totem', 'registry.json'), '{ not json', 'utf-8');

    // The seam getter throws AFTER the registry read populated its warnings —
    // the nearest injectable stand-in for a scan-side failure, since
    // `scanEstate` contains its own probe failures.
    const seams = {};
    Object.defineProperty(seams, 'wtRoots', {
      get(): string[] {
        throw new Error('scan-side failure');
      },
      enumerable: true,
    });

    const result = await checkEstate(seams);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Estate scan failed: scan-side failure');
    expect(result.message).toContain('Sync registry unreadable');
  });

  it('keeps the WORKTREE-registry disclosure when the scan itself throws', async () => {
    // The wt-side symmetry of the catch-arm fix (bot round, CR finding 3):
    // `wtWarnings` is hoisted with `registryWarnings`, so an unreadable
    // worktrees.json survives into the scan-failed row instead of silently
    // vanishing with the throw.
    writeWtRegistry('{ not json');

    // One registry entry keeps the scan off the empty short-circuit; the
    // throwing `safeExec` getter fires AFTER the worktree-registry read has
    // populated its warnings, landing the row in the catch arm.
    const seams: Parameters<typeof checkEstate>[0] = {
      registry: {
        [path.join(estateHome, 'repo')]: {
          path: path.join(estateHome, 'repo'),
          chunkCount: 0,
          lastSync: '2026-08-01T00:00:00.000Z',
          embedder: 'x',
        },
      },
    };
    Object.defineProperty(seams, 'safeExec', {
      get(): never {
        throw new Error('scan-side failure');
      },
      enumerable: true,
    });

    const result = await checkEstate(seams);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Estate scan failed: scan-side failure');
    expect(result.message).toContain('Cannot read worktree registry');
  });

  it('still skips when the recorded root no longer exists (empty sweep, not a hole)', async () => {
    writeWtRegistry(
      JSON.stringify({ schemaVersion: 1, roots: [path.join(estateHome, 'gone')], worktrees: {} }),
    );
    const result = await checkEstate({ registry: {} });
    expect(result.status).toBe('skip');
    expect(result.message).toContain('No registered repos');
  });

  it('treats an unreadable worktrees.json as degraded state, never a clean skip', async () => {
    // Round 2, CR outside-diff finding, short-circuit half: an unreadable
    // worktree registry yields zero roots — exactly what routes the row onto
    // the empty short-circuit — so the skip arm itself must disclose it.
    writeWtRegistry('{ not json');
    const result = await checkEstate({ registry: {} });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Worktree registry unreadable');
    expect(result.message).toContain('Cannot read worktree registry');
    // The scan never ran — the row must not claim a clean sweep.
    expect(result.message).not.toContain('no stale worktrees');
    expect(result.remediation).toContain('worktrees.json');
    // Degraded, but never a fail: the row is sensor-class.
    expect(result.gateExempt).toBe(true);
  });

  it('names BOTH files in the remediation when both registries are unreadable', async () => {
    // Round 3, CR inline: the sync-registry arm wins precedence and its
    // message carries wtNote(), but a remediation naming only registry.json
    // would leave the next run warning again on the file it never mentioned.
    fs.mkdirSync(path.join(estateHome, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(estateHome, '.totem', 'registry.json'), '{ not json', 'utf-8');
    writeWtRegistry('{ not json');
    const result = await checkEstate();
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Registry unreadable');
    expect(result.message).toContain('Cannot read worktree registry');
    expect(result.remediation).toContain('registry.json');
    expect(result.remediation).toContain('worktrees.json');
    expect(result.gateExempt).toBe(true);
  });

  it('demotes an otherwise-clean scan to warn when worktrees.json is unreadable', async () => {
    // Round 2, CR outside-diff finding, clean-arm half: the scan ran (one
    // registry entry routes past the short-circuit; a missing repo path needs
    // no git), but an unreadable worktree registry may name recorded roots
    // the sweep never saw — a green line would overstate the coverage.
    writeWtRegistry('{ not json');
    const missingRepo = path.join(estateHome, 'gone-repo');
    const result = await checkEstate({
      registry: {
        [missingRepo]: {
          path: missingRepo,
          chunkCount: 0,
          lastSync: '2026-08-01T00:00:00.000Z',
          embedder: 'x',
        },
      },
    });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('no stale worktrees or husk candidates');
    expect(result.message).toContain('Cannot read worktree registry');
    expect(result.remediation).toContain('worktrees.json');
    expect(result.gateExempt).toBe(true);
  });

  it('honours the wtRoots seam without reading the home file', async () => {
    // The seam value flows through the same default-vs-standard partition as
    // production roots, so container semantics need the default location.
    const seamRoot = path.join(estateHome, '.totem', 'worktrees');
    fs.mkdirSync(path.join(seamRoot, 'residue'), { recursive: true });
    writeWtRegistry('{ not json');
    const result = await checkEstate({ registry: {}, wtRoots: [seamRoot] });
    expect(result.message).not.toContain('Cannot read worktree registry');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('1 husk candidate(s)');
  });
});
