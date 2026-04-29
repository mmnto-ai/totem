import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

const mockDescribeProject = vi.fn(() => ({
  project: 'test-project',
  description: 'A test project',
  tier: 'standard',
  rules: 10,
  lessons: 5,
  targets: ['**/*.ts (code/typescript-ast)'],
  partitions: { core: ['packages/core/'] },
  hooks: ['pre-push'],
}));

vi.mock('@mmnto/totem', () => ({
  CONFIG_FILES: ['totem.config.ts', 'totem.yaml', 'totem.yml', 'totem.toml'],
  describeProject: () => mockDescribeProject(),
  TotemConfigSchema: { parse: (v: unknown) => v },
  TotemError: class extends Error {
    recoveryHint?: string;
  },
  // Stubs used by state-extractors (imported transitively via the tool).
  resolveGitRoot: () => null,
  resolveStrategyRoot: () => ({
    resolved: false,
    reason: 'mock state-extractors test: no strategy root',
  }),
  safeExec: () => '',
  readJsonSafe: () => {
    // Prefixed to match Totem's error convention so the lint rule does not
    // flag this mock throw.
    throw new Error('[Totem Error] mock readJsonSafe: no file in test context');
  },
  CompiledRulesFileSchema: { parse: (v: unknown) => v },
}));

let contextError: Error | null = null;

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => {
    if (contextError) throw contextError;
    return {
      projectRoot: '/fake/project',
      config: { targets: [], totemDir: '.totem' },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { registerDescribeProject } from './describe-project.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeServer() {
  return {
    registerTool: vi.fn((_name: string, _schema: unknown, handler: typeof capturedHandler) => {
      capturedHandler = handler;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('describe_project MCP tool', () => {
  beforeEach(() => {
    contextError = null;
    mockDescribeProject.mockClear();
  });

  it('registers the tool with correct name and schema', () => {
    const server = fakeServer();
    registerDescribeProject(server as never);
    expect(server.registerTool).toHaveBeenCalledOnce();
    expect(server.registerTool.mock.calls[0]![0]).toBe('describe_project');
  });

  it('returns structured JSON when context is available', async () => {
    const server = fakeServer();
    registerDescribeProject(server as never);

    const result = (await capturedHandler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.project).toBe('test-project');
    expect(parsed.tier).toBe('standard');
    expect(parsed.rules).toBe(10);
    expect(parsed.lessons).toBe(5);
  });

  it('delegates to describeProject on each call', async () => {
    const server = fakeServer();
    registerDescribeProject(server as never);

    await capturedHandler({});
    expect(mockDescribeProject).toHaveBeenCalledOnce();
  });

  it('returns isError when both context and fallback fail', async () => {
    contextError = new Error('[Totem Error] No config');

    const originalCwd = process.cwd;
    process.cwd = () => '/nonexistent/path/no-totem-here';
    try {
      const server = fakeServer();
      registerDescribeProject(server as never);

      const result = (await capturedHandler({})) as {
        content: { text: string }[];
        isError: boolean;
      };
      expect(result.isError).toBe(true);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it('omits richState when includeRichState is false (default)', async () => {
    const server = fakeServer();
    registerDescribeProject(server as never);

    const result = (await capturedHandler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.richState).toBeUndefined();
    // Legacy shape preserved byte-by-byte when richState is absent.
    expect(parsed).toEqual({
      project: 'test-project',
      description: 'A test project',
      tier: 'standard',
      rules: 10,
      lessons: 5,
      targets: ['**/*.ts (code/typescript-ast)'],
      partitions: { core: ['packages/core/'] },
      hooks: ['pre-push'],
    });
  });

  it('omits richState when includeRichState is explicitly false', async () => {
    const server = fakeServer();
    registerDescribeProject(server as never);

    const result = (await capturedHandler({ includeRichState: false })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.richState).toBeUndefined();
  });

  it('attaches richState when includeRichState is true', async () => {
    const server = fakeServer();
    registerDescribeProject(server as never);

    const result = (await capturedHandler({ includeRichState: true })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.richState).toBeDefined();
    // Legacy fields remain attached alongside richState.
    expect(parsed.project).toBe('test-project');
    // Rich-state contract: every documented section is present (even if null/zero/empty).
    expect(parsed.richState).toHaveProperty('strategyPointer');
    expect(parsed.richState).toHaveProperty('gitState');
    expect(parsed.richState).toHaveProperty('packageVersions');
    expect(parsed.richState).toHaveProperty('ruleCounts');
    expect(parsed.richState).toHaveProperty('lessonCount');
    expect(parsed.richState).toHaveProperty('testCount');
    expect(parsed.richState).toHaveProperty('milestone');
    expect(parsed.richState).toHaveProperty('recentPrs');
    // testCount pinned to null for v1.
    expect(parsed.richState.testCount).toBeNull();
    // milestone.bestEffort pinned to true.
    expect(parsed.richState.milestone.bestEffort).toBe(true);
  });
});
