// Fixture: the #1490 rule MUST fire on every call below. Bare-call-site
// convention from PR1. The rule's per-family coverage test asserts >= 7
// matches total, so any single sub-pattern regression drops the count
// below 7 and fails with a diff.
/* eslint-disable no-undef */

// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const payload: string;
declare const Buffer: { from: (...a: unknown[]) => unknown };
declare const atob: (s: string) => string;
declare const btoa: (s: string) => string;
declare const hidden: string;
declare const log: (s: unknown) => void;

// --- (1) String.fromCharCode payload assembly ---
log(String.fromCharCode(99, 117, 114, 108));

// --- (2) Buffer.from hex decoding ---
log(Buffer.from('68747470733a2f2f6e67726f6b2e696f', 'hex'));

// --- (3) Buffer.from base64 decoding ---
log(Buffer.from('aHR0cHM6Ly9uZ3Jvay5pby9zdGVhbA==', 'base64'));

// --- (4) atob (browser-native base64 decode) ---
log(atob(payload));

// --- (5) btoa (browser-native base64 encode) ---
log(btoa(payload));

// --- (6) Numeric-array .map().join() ---
// totem-ignore: the .join('') shape IS the attack pattern under test.
log([119, 103, 101, 116].map((c) => String.fromCharCode(c)).join(''));

// --- (7) .split().reverse().join() string reversal ---
// totem-ignore: the .join('') shape IS the attack pattern under test.
log(hidden.split('').reverse().join(''));
