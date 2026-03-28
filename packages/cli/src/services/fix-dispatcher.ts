import * as fs from 'node:fs';
import * as path from 'node:path';

import { safeExec } from '@mmnto/totem';

const FIX_SYSTEM_PROMPT = `You are a code fix agent. Given a file and a review finding, produce the COMPLETE fixed file content.

Rules:
- Output ONLY the fixed file content inside a single code block
- Do NOT add explanations before or after the code block
- Make the MINIMAL change needed to address the finding
- Do NOT refactor surrounding code or add features
- Preserve all existing formatting, comments, and structure`;

export interface FixResult {
  applied: boolean;
  commitSha?: string;
  reason?: string;
}

/**
 * Apply a fix for a single finding: read file, LLM patch, write, commit, return SHA.
 * Sequential — no concurrency concerns.
 */
export async function dispatchFix(opts: {
  filePath: string;
  line?: number;
  findingBody: string;
  findingTool: string;
  cwd: string;
  runOrchestrator: (prompt: string) => Promise<string | undefined>;
  onLog?: (msg: string) => void;
}): Promise<FixResult> {
  const { filePath, line, findingBody, findingTool, cwd, onLog } = opts;

  // 1. Validate and read the target file
  const absPath = path.resolve(cwd, filePath);
  if (!absPath.startsWith(path.resolve(cwd))) {
    return { applied: false, reason: `Path traversal blocked: ${filePath}` };
  }
  let originalContent: string;
  try {
    originalContent = fs.readFileSync(absPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, reason: `Cannot read ${filePath}: ${msg}` };
  }

  // 2. Build prompt
  const lineContext = line != null ? `The finding is at line ${line}.` : '';
  const prompt = [
    FIX_SYSTEM_PROMPT,
    '',
    `=== FILE: ${filePath} ===`,
    '```',
    originalContent,
    '```',
    '',
    `=== FINDING (${findingTool}) ===`,
    lineContext,
    findingBody,
    '',
    `Output the complete fixed file content in a single code block.`,
  ].join('\n');

  // 3. Call LLM
  onLog?.(`Generating fix for ${filePath}...`);
  let response: string | undefined;
  try {
    response = await opts.runOrchestrator(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, reason: `LLM call failed: ${msg}` };
  }

  if (!response) {
    return { applied: false, reason: 'No response from LLM' };
  }

  // 4. Extract code block from response
  const codeMatch = response.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (!codeMatch?.[1]) {
    return { applied: false, reason: 'Could not extract code block from LLM response' };
  }

  const fixedContent = codeMatch[1];

  // 5. Check if content actually changed
  if (fixedContent.trim() === originalContent.trim()) {
    onLog?.(`No changes needed for ${filePath}`);
    return { applied: false, reason: 'LLM returned unchanged content' };
  }

  // 6. Write fixed file
  fs.writeFileSync(absPath, fixedContent, 'utf-8');

  // 7. Commit (rollback file on failure)
  const summaryLine =
    findingBody
      .split('\n')
      .find((l) => l.trim())
      ?.replace(/^[#*>\-\s]+/, '')
      .slice(0, 60) ?? 'bot review fix';
  const commitMsg = `fix: ${summaryLine}\n\nFinding: ${findingTool} on ${filePath}${line != null ? `:${line}` : ''}`;

  try {
    safeExec('git', ['add', filePath], { cwd });
    safeExec('git', ['commit', '-m', commitMsg], { cwd });
    const sha = safeExec('git', ['rev-parse', '--short', 'HEAD'], { cwd }).trim();
    onLog?.(`Committed fix: ${sha}`);
    return { applied: true, commitSha: sha };
  } catch (err) {
    // Rollback: restore original content and unstage
    try {
      fs.writeFileSync(absPath, originalContent, 'utf-8');
      safeExec('git', ['reset', 'HEAD', '--', filePath], { cwd });
    } catch {
      // Best-effort rollback
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { applied: false, reason: `Git commit failed (rolled back): ${msg}` };
  }
}
