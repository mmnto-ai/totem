// Fixture: the #1490 rule MUST NOT fire on any call below. Benign uses of
// the same ambient primitives (String, Buffer, Array, string methods) that
// are NOT in the obfuscation shapes the rule targets.
// @ts-nocheck — fixture file, not expected to type-check cleanly

declare const Buffer: { from: (...a: unknown[]) => unknown };
declare const base: string;
declare const path: string;
declare const host: string;
declare const id: string;
declare const text: string;
declare const csv: string;
declare const str: string;
declare const sep: string;
declare const records: Array<{ id: string }>;
declare const log: (s: unknown) => void;

// --- Standard string concatenation (not fragmentation) ---
log(base + '/' + path);

// --- Template literals for URL assembly ---
log(`https://${host}/items/${id}`);

// --- JSON round-trip (legitimate Buffer use without hex/base64) ---
log(Buffer.from(JSON.stringify({ a: 1 }), 'utf8'));

// --- Buffer.from with utf-8 encoding (NOT hex or base64) ---
log(Buffer.from(text, 'utf8'));

// --- Array.prototype.map over non-numeric data ---
log(records.map((r) => r.id));

// --- String.split without reverse-and-join ---
log(csv.split(','));
log(
  csv
    .split(',')
    .map((s) => s.trim())
    .join(';'),
);

// --- String.split().join() without reverse() ---
log(str.split(sep).join('-'));

// --- Other Array methods ---
log(Array.from([1, 2, 3]));
