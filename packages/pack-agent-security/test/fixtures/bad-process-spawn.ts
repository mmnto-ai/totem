// Fixture: the #1486 rule MUST fire on every line below.
// Each line is a canonical attack-pattern call site in a non-build path.
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable import/no-commonjs */
/* eslint-disable no-undef */

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const spawn: (...a: unknown[]) => unknown;
declare const spawnSync: (...a: unknown[]) => unknown;
declare const exec: (...a: unknown[]) => unknown;
declare const execSync: (...a: unknown[]) => unknown;
declare const execFile: (...a: unknown[]) => unknown;
declare const execFileSync: (...a: unknown[]) => unknown;
declare const fork: (...a: unknown[]) => unknown;
declare const execa: ((...a: unknown[]) => unknown) & { sync: (...a: unknown[]) => unknown };
declare const execaSync: (...a: unknown[]) => unknown;
declare const userInput: string;

spawn(userInput);
spawnSync(userInput);
exec(userInput);
execSync(userInput);
execFile(userInput);
execFileSync(userInput);
fork(userInput);
execa(userInput);
execaSync(userInput);
execa.sync(userInput);
