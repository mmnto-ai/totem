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
});
