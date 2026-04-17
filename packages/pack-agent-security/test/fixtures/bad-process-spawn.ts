// Fixture: the #1486 rule MUST fire on every line below.
// Each line is a canonical attack-pattern call site in a non-build path.
// Inline `// totem-ignore` on attack lines keeps Totem's own corpus rules
// from firing on this fixture during repo-level lint — the pack's own
// direct-pattern matcher in rules.test.ts is suppression-agnostic.
/* eslint-disable @typescript-eslint/no-require-imports */
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

// --- Bare-identifier call sites (the primitives imported as named exports) ---
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

// --- Require-based call sites (GCA #1486 coverage gap) ---
require('child_process').spawn(userInput); // totem-ignore
require('child_process').spawnSync(userInput); // totem-ignore
require('child_process').exec(userInput); // totem-ignore
require('child_process').execSync(userInput); // totem-ignore
require('child_process').execFile(userInput); // totem-ignore
require('child_process').execFileSync(userInput); // totem-ignore
require('child_process').fork(userInput); // totem-ignore

// --- Node-protocol variant of the require-based call sites ---
require('node:child_process').spawn(userInput); // totem-ignore
require('node:child_process').spawnSync(userInput); // totem-ignore
require('node:child_process').exec(userInput); // totem-ignore
require('node:child_process').execSync(userInput); // totem-ignore
require('node:child_process').execFile(userInput); // totem-ignore
require('node:child_process').execFileSync(userInput); // totem-ignore
require('node:child_process').fork(userInput); // totem-ignore
