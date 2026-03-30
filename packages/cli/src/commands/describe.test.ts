import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getProjectDescription } from './describe.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-describe-'));
}

function cleanTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/** Scaffold a minimal totem project in a temp dir. */
function scaffoldProject(
  dir: string,
  opts: { lessons?: number; rules?: number; partitions?: Record<string, string[]> } = {},
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

  // .totem/compiled-rules.json
  const rulesCount = opts.rules ?? 0;
  if (rulesCount > 0) {
    const rules = Array.from({ length: rulesCount }, (_, i) => ({ id: `rule-${i}` }));
    fs.writeFileSync(path.join(dir, '.totem', 'compiled-rules.json'), JSON.stringify(rules));
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
    } finally {
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
