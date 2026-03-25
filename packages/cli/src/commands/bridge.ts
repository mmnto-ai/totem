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
        ? `${fileList}\n... and ${lines.length - MAX_STATUS_FILES} more file${lines.length - MAX_STATUS_FILES === 1 ? '' : 's'}`
        : fileList;
    sections.push(`**Modified Files:**\n${summary}`);
  } else {
    sections.push('**Modified Files:** (clean working tree)');
  }

  // Breadcrumb message
  if (message) {
    const sanitized = message.replace(/<\/\s*([a-zA-Z0-9_]+)\s*>/gi, '<\\/$1>');
    sections.push(`**Current Task / Breadcrumb:** "${sanitized}"`);
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

export async function bridgeCommand(options: BridgeOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { TotemGitError } = await import('@mmnto/totem');
  const { getGitBranch, getGitStatus } = await import('../git.js');
  const { log } = await import('../ui.js');
  const { writeOutput } = await import('../utils.js');

  const cwd = process.cwd();

  if (!fs.existsSync(path.join(cwd, '.git'))) {
    throw new TotemGitError(
      'Not a git repository.',
      'Run `totem bridge` from a project with git initialized.',
    );
  }

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
