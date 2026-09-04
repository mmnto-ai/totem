import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { formatRulesLine, getProjectDescription } from './describe.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-describe-'));
}

function cleanTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/** Scaffold a minimal totem project in a temp dir. */
function scaffoldProject(
  dir: string,
  opts: {
    lessons?: number;
    rules?: number;
    archived?: number;
    partitions?: Record<string, string[]>;
  } = {},
) {
  // totem.config.ts
  const partitions = opts.partitions ? JSON.stringify(opts.partitions) : undefined;
  const configLines = [
    'export default {',
    '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
    '  embedding: { provider: "gemini" },',
    partitions ? `  partitions: ${partitions},` : '',
    '};',
  ];
  fs.writeFileSync(path.join(dir, 'totem.config.ts'), configLines.join('\n'));

  // package.json
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', description: 'A test project' }),
  );

  // .totem/lessons
  const lessonsDir = path.join(dir, '.totem', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  for (let i = 0; i < (opts.lessons ?? 0); i++) {
    fs.writeFileSync(path.join(lessonsDir, `lesson-${i}.md`), `# Lesson ${i}`);
  }

  // .totem/compiled-rules.json — canonical object envelope shape
  // (`{ version, rules: [...] }`) matching `loadCompiledRulesFile` and
  // the rest of the codebase. Prior versions of this helper wrote a bare
  // array, which masked the rule-count bug fixed in mmnto-ai/totem#1884.
  // Entries are SCHEMA-VALID compiled rules since mmnto-ai/totem#2765: describe
  // now counts through the same validating loader lint and status use, so a
  // `{ id }` stub would (correctly) count as nothing. `archived` marks the
  // first N entries inert.
  const rulesCount = opts.rules ?? 0;
  if (rulesCount > 0) {
    const rules = Array.from({ length: rulesCount }, (_, i) => ({
      lessonHash: `hash${String(i).padStart(8, '0')}`,
      lessonHeading: `Rule ${i}`,
      pattern: 'dummy',
      message: `Rule ${i} message`,
      engine: 'regex',
      compiledAt: '2026-05-11T00:00:00Z',
      ...(i < (opts.archived ?? 0) ? { status: 'archived' } : {}),
    }));
    fs.writeFileSync(
      path.join(dir, '.totem', 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules, nonCompilable: [] }),
    );
  }
}

describe('getProjectDescription', () => {
  it('returns project name and description from package.json', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir);
      const result = await getProjectDescription(dir);
      expect(result.project).toBe('test-project');
      expect(result.description).toBe('A test project');
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('returns correct tier based on config', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir);
      const result = await getProjectDescription(dir);
      expect(result.tier).toBe('standard'); // has embedding, no orchestrator
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('counts lessons from .totem/lessons directory', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir, { lessons: 5 });
      const result = await getProjectDescription(dir);
      expect(result.lessons).toBe(5);
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('counts rules from compiled-rules.json', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir, { rules: 10 });
      const result = await getProjectDescription(dir);
      expect(result.rules).toBe(10);
      expect(result.rulesCompiled).toBe(10);
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('counts the ACTIVE set, not the raw total, and renders the split (mmnto-ai/totem#2765)', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir, { rules: 10, archived: 3 });
      const result = await getProjectDescription(dir);
      expect(result.rules).toBe(7);
      expect(result.rulesCompiled).toBe(10);
      expect(result.rulesArchived).toBe(3);
      expect(formatRulesLine(result)).toBe('Rules: 7 active of 10 compiled (3 archived)');
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('formatRulesLine: the split renders only when non-trivial, and names every inert status', () => {
    const base = {
      rules: 12,
      rulesCompiled: 12,
      rulesArchived: 0,
      rulesUntested: 0,
      rulesPendingVerification: 0,
      rulesSource: 'compiled-rules' as const,
    };
    expect(formatRulesLine(base)).toBe('Rules: 12 active');
    expect(
      formatRulesLine({
        ...base,
        rulesCompiled: 20,
        rulesArchived: 5,
        rulesUntested: 2,
        rulesPendingVerification: 1,
      }),
    ).toBe(
      'Rules: 12 active of 20 compiled (5 archived, 2 untested-against-codebase, 1 pending-verification)',
    );
    // The ACTIVE count leads; the raw total never poses as the enforced set.
    expect(formatRulesLine({ ...base, rulesCompiled: 20, rulesArchived: 8 })).toMatch(
      /^Rules: 12 active/,
    );
    expect(formatRulesLine({ ...base, rulesCompiled: 20, rulesArchived: 8 })).not.toMatch(
      /^Rules: 20/,
    );
    // A zero is never left ambiguous: absent and unreadable each say so.
    const zeros = { ...base, rules: 0, rulesCompiled: 0 };
    expect(formatRulesLine({ ...zeros, rulesSource: 'absent' })).toBe(
      'Rules: 0 active (no compiled-rules.json)',
    );
    expect(formatRulesLine({ ...zeros, rulesSource: 'unreadable' })).toContain(
      'compiled-rules.json unreadable',
    );
  });

  // The issue's own contract clause, second conjunct: describe's number equals
  // what `totem status` PRINTS (mmnto-ai/totem#2765). The two commands share no
  // helper — status counts through `loadCompiledRules` inline, describe through
  // `isActiveCompiledRule` — so this is the only place the two numbers meet.
  it('describe reports the same active count that totem status prints', async () => {
    const dir = makeTmpDir();
    const originalCwd = process.cwd();
    try {
      scaffoldProject(dir, { rules: 10, archived: 4 });
      const description = await getProjectDescription(dir);
      process.chdir(dir);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { statusCommand } = await import('./status.js');
      await statusCommand();
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      const printed = /Rules: (\d+) compiled/.exec(output);
      expect(printed, output).not.toBeNull();
      expect(Number(printed![1])).toBe(6);
      expect(description.rules).toBe(Number(printed![1]));
    } finally {
      process.chdir(originalCwd);
      vi.restoreAllMocks();
      cleanTmpDir(dir);
    }
  });

  it('returns zero counts when .totem directories are missing', async () => {
    const dir = makeTmpDir();
    try {
      // Minimal config, no .totem dir at all
      fs.writeFileSync(
        path.join(dir, 'totem.config.ts'),
        'export default { targets: [{ glob: "**/*.md", type: "spec", strategy: "markdown-heading" }] };',
      );
      const result = await getProjectDescription(dir);
      expect(result.rules).toBe(0);
      expect(result.lessons).toBe(0);
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('includes partitions from config', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir, { partitions: { core: ['packages/core/'], cli: ['packages/cli/'] } });
      const result = await getProjectDescription(dir);
      expect(result.partitions).toEqual({ core: ['packages/core/'], cli: ['packages/cli/'] });
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('returns empty partitions when none configured', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir);
      const result = await getProjectDescription(dir);
      expect(result.partitions).toEqual({});
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('includes targets from config', async () => {
    const dir = makeTmpDir();
    try {
      scaffoldProject(dir);
      const result = await getProjectDescription(dir);
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0]).toContain('**/*.ts');
      expect(result.targets[0]).toContain('code');
    } finally {
      cleanTmpDir(dir);
    }
  });

  it('falls back to directory name when no package.json', async () => {
    const dir = makeTmpDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'totem.config.ts'),
        'export default { targets: [{ glob: "**/*.md", type: "spec", strategy: "markdown-heading" }] };',
      );
      const result = await getProjectDescription(dir);
      expect(result.project).toBe(path.basename(dir));
      expect(result.description).toBeUndefined();
    } finally {
      cleanTmpDir(dir);
    }
  });
});
