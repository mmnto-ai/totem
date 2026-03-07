import { getGitBranch, getGitStatus } from '../git.js';
import { log } from '../ui.js';
import { writeOutput } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Bridge';
const MAX_STATUS_FILES = 20;

// ─── Prompt assembly ────────────────────────────────────

export function assembleBridge(branch: string, status: string, message?: string): string {
  const sections: string[] = ['# Context Bridge'];

  sections.push(`**Branch:** ${branch}`);

  // Summarize modified files
  if (status.trim()) {
    const lines = status.trim().split('\n');
    const fileList = lines.slice(0, MAX_STATUS_FILES).join('\n');
    const summary =
      lines.length > MAX_STATUS_FILES
        ? `${fileList}\n... and ${lines.length - MAX_STATUS_FILES} more files`
        : fileList;
    sections.push(`**Modified Files:**\n${summary}`);
  } else {
    sections.push('**Modified Files:** (clean working tree)');
  }

  // Breadcrumb message
  if (message) {
    sections.push(`**Current Task / Breadcrumb:** "${message}"`);
  }

  sections.push(
    '**Instruction:** Resume work based on the current uncommitted changes and the breadcrumb above. Do not restart the task from scratch.',
  );

  return sections.join('\n\n');
}

// ─── Main command ───────────────────────────────────────

export interface BridgeOptions {
  message?: string;
  out?: string;
}

export function bridgeCommand(options: BridgeOptions): void {
  const cwd = process.cwd();

  log.info(TAG, 'Capturing workspace state...');
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  log.info(TAG, `Branch: ${branch}`);

  const output = assembleBridge(branch, status, options.message);

  writeOutput(output, options.out);
  if (options.out) {
    log.success(TAG, `Written to ${options.out}`);
  }
  log.success(TAG, 'Context bridge generated. Paste this into your new session.');
}
