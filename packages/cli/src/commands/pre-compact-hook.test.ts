/**
 * PreCompact hook invariants.
 *
 * The hook at `.claude/hooks/pre-compact.sh` runs before Claude Code
 * auto-compaction. Its exit-code contract is load-bearing: exit 2 would
 * block compaction, which is worse than any breadcrumb failure. These
 * tests lock in the nine invariants from `.totem/specs/1460.md`.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'pre-compact.sh');
const CACHE = path.join(ROOT, '.totem', 'cache');
const ARTIFACT_RE = /^\.pre-compact-signoff-\d{8}T\d{6}Z(-\d+)?\.md$/;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// 1-second buffer absorbs file systems with 1s mtime resolution (some
// network mounts, older filesystems) where the recorded mtime may lag
// the wall clock by a fraction of a second.
const MTIME_BUFFER_MS = 1_000;

function getFreshArtifacts(callStart: number): string[] {
  if (!fs.existsSync(CACHE)) return [];
  return fs
    .readdirSync(CACHE)
    .filter((f) => ARTIFACT_RE.test(f))
    .map((f) => path.join(CACHE, f))
    .filter((p) => fs.statSync(p).mtimeMs >= callStart - MTIME_BUFFER_MS);
}

function runHook(stdin = '', timeoutMs = 10_000): RunResult {
  const start = Date.now();
  try {
    const stdout = execFileSync('bash', [HOOK], {
      input: stdin,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0, durationMs: Date.now() - start };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf-8') ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString('utf-8') ?? ''),
      exitCode: e.status ?? -1,
      durationMs: Date.now() - start,
    };
  }
}

describe('PreCompact hook (mmnto-ai/totem#1460)', () => {
  // Record the test-suite start time so cleanup deletes only artifacts
  // created during this run, not pre-existing ones.
  const testSuiteStart = Date.now();

  afterAll(() => {
    if (!fs.existsSync(CACHE)) return;
    for (const entry of fs.readdirSync(CACHE)) {
      if (!ARTIFACT_RE.test(entry)) continue;
      const p = path.join(CACHE, entry);
      try {
        if (fs.statSync(p).mtimeMs >= testSuiteStart - MTIME_BUFFER_MS) {
          fs.unlinkSync(p);
        }
      } catch {
        // best-effort cleanup; leaked artifacts are harmless
      }
    }
  });

  it('hook file exists with a bash shebang', () => {
    expect(fs.existsSync(HOOK)).toBe(true);
    const content = fs.readFileSync(HOOK, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('hook passes bash syntax check', () => {
    expect(() => execFileSync('bash', ['-n', HOOK], { stdio: 'pipe' })).not.toThrow();
  });

  it('installs an EXIT trap that coerces non-zero exits to exit 1', () => {
    const content = fs.readFileSync(HOOK, 'utf-8');
    expect(content).toMatch(/trap\b[^\n]*\bexit 1\b[^\n]*\bEXIT\b/);
  });

  it('contains no network-call binaries (no curl, no wget)', () => {
    const content = fs.readFileSync(HOOK, 'utf-8');
    expect(content).not.toMatch(/\bcurl\b/);
    expect(content).not.toMatch(/\bwget\b/);
  });

  it('happy path: exits 0 and writes an artifact with a fresh mtime', () => {
    const callStart = Date.now();
    const result = runHook();
    expect(result.exitCode).toBe(0);

    const freshArtifacts = getFreshArtifacts(callStart);
    expect(freshArtifacts.length).toBeGreaterThan(0);
  });

  it('artifact contents include the required fields', () => {
    const callStart = Date.now();
    const result = runHook();
    expect(result.exitCode).toBe(0);

    const latest = getFreshArtifacts(callStart).sort().pop();
    expect(latest).toBeDefined();

    const content = fs.readFileSync(latest as string, 'utf-8');
    expect(content).toMatch(/^# Pre-compact signoff \d{8}T\d{6}Z$/m);
    expect(content).toMatch(/\*\*Branch:\*\*/);
    expect(content).toMatch(/\*\*HEAD:\*\*/);
    expect(content).toMatch(/## git status --short/);
    expect(content).toMatch(/## Last 5 commits/);
  });

  it('completes within 10 seconds worst-case on a local repo', () => {
    const result = runHook('', 10_000);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it('ignores stdin content (runs identically with garbage input)', () => {
    const bogus = JSON.stringify({ event: 'PreCompact', made: 'up', fields: [1, 2, 3] });
    const result = runHook(bogus);
    expect(result.exitCode).toBe(0);
  });

  it('never exits 2 even when given malformed stdin', () => {
    const malformed = 'not json {{{{{}}}}}';
    const result = runHook(malformed);
    expect(result.exitCode).not.toBe(2);
  });
});
