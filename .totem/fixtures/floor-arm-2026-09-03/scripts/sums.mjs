// Seal every file in a fixture directory: sha256sum binary format ("<hex> *<relative path>"),
// one per line, sorted by path, LF endings — the same shape as ../spec-runs-2026-09-02/SHA256SUMS.
// SHA256SUMS itself is excluded. Usage: node sums.mjs --dir <fixture dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const DIR = args.dir;
if (!DIR) {
  console.error('usage: node sums.mjs --dir <fixture dir>');
  process.exit(2);
}
const NL = String.fromCharCode(10);
const SUMS = 'SHA256SUMS';

function walk(rel) {
  const abs = rel ? path.join(DIR, rel) : DIR;
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...walk(r));
    else if (entry.isFile() && r !== SUMS) out.push(r);
  }
  return out;
}

const files = walk('').sort();
const lines = files.map(
  (r) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, r))).digest('hex') + ' *' + r,
);
fs.writeFileSync(path.join(DIR, SUMS), lines.join(NL) + NL);
console.log(lines.join(NL));
