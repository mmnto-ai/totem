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

/**
 * Create a spinner that writes to stderr.
 * Falls back to static log lines in non-TTY environments (CI, piped).
 */
export async function createSpinner(tag: string, text: string): Promise<Spinner> {
  const isTTY = !!process.stderr.isTTY;

  if (!isTTY) {
    // Non-interactive: static log lines
    console.error(`${prefix(tag)} ${text}`);
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
    text: `${prefix(tag)} ${text}`,
    stream: process.stderr,
  }).start();

  return {
    update(newText: string) {
      spinner.text = `${prefix(tag)} ${newText}`;
    },
    succeed(doneText?: string) {
      spinner.succeed(doneText ? `${prefix(tag)} ${doneText}` : undefined);
    },
    fail(errText?: string) {
      spinner.fail(errText ? `${prefix(tag)} ${errText}` : undefined);
    },
    stop() {
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
