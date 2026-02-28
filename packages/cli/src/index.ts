#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('totem')
  .description('Totem — persistent memory and context layer for AI agents')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Totem in the current project')
  .action(async () => {
    try {
      await initCommand();
    } catch (err) {
      console.error('[Totem Error]', err);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Re-index project files into the local vector store')
  .option('--full', 'Force a full re-index (ignores incremental)')
  .action(async (opts: { full?: boolean }) => {
    try {
      const { syncCommand } = await import('./commands/sync.js');
      await syncCommand(opts);
    } catch (err) {
      console.error('[Totem Error]', err);
      process.exit(1);
    }
  });

program
  .command('search <query>')
  .description('Search the knowledge index')
  .option('-t, --type <type>', 'Filter by content type (code, session_log, spec)')
  .option('-n, --max-results <n>', 'Maximum results to return', '5')
  .action(async (query: string, opts: { type?: string; maxResults?: string }) => {
    try {
      const { searchCommand } = await import('./commands/search.js');
      await searchCommand(query, opts);
    } catch (err) {
      console.error('[Totem Error]', err);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show index statistics')
  .action(async () => {
    try {
      const { statsCommand } = await import('./commands/stats.js');
      await statsCommand();
    } catch (err) {
      console.error('[Totem Error]', err);
      process.exit(1);
    }
  });

program.parse();
