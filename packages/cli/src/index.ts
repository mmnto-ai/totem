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
  .action(() => {
    console.log('[Totem] sync is not yet implemented (Phase 2)');
  });

program
  .command('search <query>')
  .description('Search the knowledge index')
  .option('-t, --type <type>', 'Filter by content type (code, session_log, spec)')
  .option('-n, --max-results <n>', 'Maximum results to return', '5')
  .action((query: string, opts: { type?: string; maxResults?: string }) => {
    console.log('[Totem] search is not yet implemented (Phase 2)');
    console.log(`  query: ${query}, type: ${opts.type ?? 'all'}, max: ${opts.maxResults ?? '5'}`);
  });

program
  .command('stats')
  .description('Show index statistics')
  .action(() => {
    console.log('[Totem] stats is not yet implemented (Phase 2)');
  });

program.parse();
