import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import type { IngestTarget } from '@mmnto/totem';

interface DetectedProject {
  hasTypeScript: boolean;
  hasSrc: boolean;
  hasDocs: boolean;
  hasSpecs: boolean;
  hasContext: boolean;
  hasSessions: boolean;
}

function detectProject(cwd: string): DetectedProject {
  const exists = (p: string) => fs.existsSync(path.join(cwd, p));
  return {
    hasTypeScript: exists('tsconfig.json'),
    hasSrc: exists('src'),
    hasDocs: exists('docs'),
    hasSpecs: exists('specs'),
    hasContext: exists('context'),
    hasSessions: exists('context/sessions'),
  };
}

function buildTargets(detected: DetectedProject): IngestTarget[] {
  const targets: IngestTarget[] = [];

  if (detected.hasTypeScript) {
    targets.push(
      { glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' },
      { glob: 'src/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
    );

    if (!detected.hasSrc) {
      // Monorepo layout — scan packages/
      targets.push(
        { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
        { glob: 'packages/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
      );
    }
  }

  if (detected.hasSessions) {
    targets.push({
      glob: 'context/sessions/**/*.md',
      type: 'session_log',
      strategy: 'session-log',
    });
  }

  if (detected.hasSpecs) {
    targets.push({
      glob: 'specs/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  if (detected.hasDocs) {
    targets.push({
      glob: 'docs/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  if (detected.hasContext) {
    targets.push({
      glob: 'context/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  // Fallback: if nothing detected, add a sensible default
  if (targets.length === 0) {
    targets.push({
      glob: '**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  return targets;
}

function formatTargets(targets: IngestTarget[]): string {
  const lines = targets.map((t) => {
    return `    { glob: '${t.glob}', type: '${t.type}', strategy: '${t.strategy}' },`;
  });
  return lines.join('\n');
}

function generateConfig(targets: IngestTarget[], provider: 'openai' | 'ollama'): string {
  const embeddingBlock =
    provider === 'openai'
      ? `  embedding: { provider: 'openai', model: 'text-embedding-3-small' },`
      : `  embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },`;

  return `import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
${formatTargets(targets)}
  ],
${embeddingBlock}
};

export default config;
`;
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'totem.config.ts');
  const totemDir = path.join(cwd, '.totem');

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    console.log('[Totem] totem.config.ts already exists. Skipping init.');
    return;
  }

  console.log('[Totem] Scanning project...');
  const detected = detectProject(cwd);

  // Log what was detected
  const detections: string[] = [];
  if (detected.hasTypeScript) detections.push('TypeScript');
  if (detected.hasSrc) detections.push('src/');
  if (detected.hasDocs) detections.push('docs/');
  if (detected.hasSpecs) detections.push('specs/');
  if (detected.hasContext) detections.push('context/');
  if (detected.hasSessions) detections.push('session logs');

  if (detections.length > 0) {
    console.log(`[Totem] Detected: ${detections.join(', ')}`);
  } else {
    console.log('[Totem] No specific project structure detected. Using markdown defaults.');
  }

  const targets = buildTargets(detected);

  // Prompt for embedding provider
  const rl = readline.createInterface({ input, output });
  let provider: 'openai' | 'ollama' = 'openai';

  try {
    const answer = await rl.question(
      'Enter your OpenAI API key (or press Enter to configure local Ollama later): ',
    );

    if (answer.trim()) {
      // Write API key to .env
      const envPath = path.join(cwd, '.env');
      const envLine = `OPENAI_API_KEY=${answer.trim()}\n`;

      if (fs.existsSync(envPath)) {
        const existing = fs.readFileSync(envPath, 'utf-8');
        if (!existing.includes('OPENAI_API_KEY')) {
          fs.appendFileSync(envPath, envLine);
        }
      } else {
        fs.writeFileSync(envPath, envLine);
      }

      console.log('[Totem] OpenAI API key saved to .env');
    } else {
      provider = 'ollama';
      console.log('[Totem] Configured for Ollama. Make sure it is running locally.');
    }
  } finally {
    rl.close();
  }

  // Generate totem.config.ts
  const configContent = generateConfig(targets, provider);
  fs.writeFileSync(configPath, configContent, 'utf-8');
  console.log('[Totem] Created totem.config.ts');

  // Create .totem/ directory with lessons.md
  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }

  const lessonsPath = path.join(totemDir, 'lessons.md');
  if (!fs.existsSync(lessonsPath)) {
    fs.writeFileSync(
      lessonsPath,
      `# Totem Lessons\n\nLessons learned from PR reviews and Shield checks.\nThis file is version-controlled and reviewed in PR diffs.\n\n---\n`,
      'utf-8',
    );
  }
  console.log('[Totem] Created .totem/lessons.md');

  // Ensure .lancedb/ is in .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.lancedb')) {
      fs.appendFileSync(gitignorePath, '\n# Totem\n.lancedb/\n');
      console.log('[Totem] Added .lancedb/ to .gitignore');
    }
  }

  console.log('[Totem] Init complete. Run `totem sync` to index your project.');
}
