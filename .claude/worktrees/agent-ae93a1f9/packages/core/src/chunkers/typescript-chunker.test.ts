import { describe, expect, it } from 'vitest';

import { TypeScriptChunker } from './typescript-chunker.js';

describe('TypeScriptChunker', () => {
  const chunker = new TypeScriptChunker();

  it('chunks function declarations', () => {
    const code = `export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`;
    const chunks = chunker.chunk(code, 'src/utils.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('function: greet');
    expect(chunks[0]!.content).toContain('export function greet');
  });

  it('chunks class declarations', () => {
    const code = `export class UserService {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }
}
`;
    const chunks = chunker.chunk(code, 'src/service.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('class: UserService');
    expect(chunks[0]!.content).toContain('getName()');
  });

  it('chunks interfaces', () => {
    const code = `export interface Config {
  port: number;
  host: string;
}
`;
    const chunks = chunker.chunk(code, 'src/types.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('interface: Config');
  });

  it('chunks type aliases', () => {
    const code = `export type Status = 'active' | 'inactive' | 'pending';
`;
    const chunks = chunker.chunk(code, 'src/types.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('type alias: Status');
  });

  it('chunks enum declarations', () => {
    const code = `export enum Direction {
  Up = 'UP',
  Down = 'DOWN',
}
`;
    const chunks = chunker.chunk(code, 'src/enums.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('enum: Direction');
  });

  it('detects React components (PascalCase arrow functions)', () => {
    const code = `export const Dashboard = () => {
  return <div>Dashboard</div>;
};
`;
    const chunks = chunker.chunk(code, 'src/Dashboard.tsx', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('component: Dashboard');
  });

  it('detects React hooks (use* prefix)', () => {
    const code = `export const useAuth = () => {
  return { user: null };
};
`;
    const chunks = chunker.chunk(code, 'src/hooks.ts', 'code');

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.label).toBe('hook: useAuth');
  });

  it('sets contextPrefix correctly', () => {
    const code = `export function myFunc() {}
`;
    const chunks = chunker.chunk(code, 'src/utils.ts', 'code');

    expect(chunks[0]!.contextPrefix).toBe("File: src/utils.ts | Context: The 'myFunc' function");
  });

  it('handles multiple declarations in one file', () => {
    const code = `export interface Options {
  verbose: boolean;
}

export function run(opts: Options): void {
  console.log(opts);
}

export class Runner {
  start() {}
}
`;
    const chunks = chunker.chunk(code, 'src/runner.ts', 'code');

    expect(chunks.length).toBe(3);
    const labels = chunks.map((c) => c.label);
    expect(labels).toContain('interface: Options');
    expect(labels).toContain('function: run');
    expect(labels).toContain('class: Runner');
  });

  it('handles empty file gracefully', () => {
    const chunks = chunker.chunk('', 'empty.ts', 'code');
    expect(chunks).toEqual([]);
  });

  it('skips files with only imports', () => {
    const code = `import { foo } from './foo';
import { bar } from './bar';
`;
    const chunks = chunker.chunk(code, 'src/index.ts', 'code');
    expect(chunks).toEqual([]);
  });

  it('sets correct line numbers', () => {
    const code = `// line 1

export function first() {
  return 1;
}

export function second() {
  return 2;
}
`;
    const chunks = chunker.chunk(code, 'src/fns.ts', 'code');

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.startLine).toBe(3);
    expect(chunks[1]!.startLine).toBe(7);
  });
});
