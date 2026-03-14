import pc from 'picocolors';

// ─── Brand colors ────────────────────────────────────

export const brand = (text: string): string => pc.cyan(text);
export const dim = (text: string): string => pc.dim(text);
export const success = (text: string): string => pc.green(text);
export const warn = (text: string): string => pc.yellow(text);
export const errorColor = (text: string): string => pc.red(text);
export const bold = (text: string): string => pc.bold(text);

// ─── Logging (all → stderr) ─────────────────────────

function prefix(tag: string): string {
  return brand(`[${tag}]`);
}

export const log = {
  info(tag: string, msg: string): void {
    console.error(`${prefix(tag)} ${msg}`);
  },
  success(tag: string, msg: string): void {
    console.error(`${prefix(tag)} ${success(msg)}`);
  },
  warn(tag: string, msg: string): void {
    console.error(`${prefix(tag)} ${warn(msg)}`);
  },
  error(tag: string, msg: string): void {
    console.error(`${prefix(tag)} ${errorColor(msg)}`);
  },
  dim(tag: string, msg: string): void {
    console.error(`${prefix(tag)} ${dim(msg)}`);
  },
};

// ─── Spinner (stderr, TTY-aware) ─────────────────────

export interface Spinner {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

import { getRandomSpinnerQuote } from './ui/quotes.js';

/**
 * Custom spinner frame resembling an Inception spinning top wobbling.
 */
const INCEPTION_TOP = {
  interval: 100,
  frames: ['◐', '◓', '◑', '◒'],
};

/**
 * Create a spinner that writes to stderr.
 * Falls back to static log lines in non-TTY environments (CI, piped).
 */
export async function createSpinner(tag: string, text?: string): Promise<Spinner> {
  const isTTY = !!process.stderr.isTTY;
  const isQuoteMode = !text; // If no text provided, we cycle quotes
  let currentText = text || getRandomSpinnerQuote();

  if (!isTTY) {
    // Non-interactive: static log lines
    console.error(`${prefix(tag)} ${currentText}`);
    return {
      update(newText: string) {
        console.error(`${prefix(tag)} ${newText}`);
      },
      succeed(doneText?: string) {
        if (doneText) console.error(`${prefix(tag)} ${doneText}`);
      },
      fail(errText?: string) {
        if (errText) console.error(`${prefix(tag)} ${errText}`);
      },
      stop() {},
    };
  }

  // Dynamic import to keep startup fast for non-spinner commands
  const ora = (await import('ora')).default;
  const spinner = ora({
    text: `${prefix(tag)} ${currentText}`,
    stream: process.stderr,
    spinner: INCEPTION_TOP,
  }).start();

  let quoteInterval: NodeJS.Timeout | null = null;

  // Cycle quotes every 4 seconds if we are in quote mode
  if (isQuoteMode) {
    quoteInterval = setInterval(() => {
      currentText = getRandomSpinnerQuote();
      spinner.text = `${prefix(tag)} ${currentText}`;
    }, 4000);
  }

  const cleanup = () => {
    if (quoteInterval) clearInterval(quoteInterval);
  };

  return {
    update(newText: string) {
      if (isQuoteMode) return; // Don't let external progress updates overwrite our movie quotes if in quote mode
      spinner.text = `${prefix(tag)} ${newText}`;
    },
    succeed(doneText?: string) {
      cleanup();
      spinner.succeed(doneText ? `${prefix(tag)} ${doneText}` : undefined);
    },
    fail(errText?: string) {
      cleanup();
      spinner.fail(errText ? `${prefix(tag)} ${errText}` : undefined);
    },
    stop() {
      cleanup();
      spinner.stop();
    },
  };
}

// ─── Banner ──────────────────────────────────────────

const BANNER = `
  ${brand('╔╦╗╔═╗╔╦╗╔═╗╔╦╗')}
  ${brand(' ║ ║ ║ ║ ║╣ ║║║')}
  ${brand(' ╩ ╚═╝ ╩ ╚═╝╩ ╩')}
  ${dim('Your AI forgets. Totem remembers.')}
`;

export function printBanner(): void {
  console.error(BANNER);
}
