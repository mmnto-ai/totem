// Fixture for rule 1c0c5a7daefdeb4b — benign code that exercises the same
// ambient primitives (String, Buffer, Array, string methods) as the bad
// fixture but NOT in the obfuscation-primitive shapes. MUST NOT fire.

// ─── Standard string concatenation (not fragmentation) ─
export function ok_concat(base: string, path: string) {
  return base + '/' + path;
}

// ─── Template literals for URL assembly ─────────────
export function ok_template_url(host: string, id: string) {
  return `https://${host}/items/${id}`;
}

// ─── JSON round-trip (legitimate Buffer use without hex/base64) ─
export function ok_buffer_json(obj: unknown) {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8');
}

// ─── Buffer.from with utf-8 encoding (NOT hex or base64) ─
export function ok_buffer_utf8(text: string) {
  return Buffer.from(text, 'utf8');
}

// ─── Array.prototype.map over non-numeric data ──────
export function ok_map_records(records: Array<{ id: string }>) {
  return records.map((r) => r.id);
}

// ─── String.split without reverse-and-join ──────────
export function ok_split_no_reverse(csv: string) {
  return csv.split(',');
}

export function ok_split_map_join(csv: string) {
  return csv
    .split(',')
    .map((s) => s.trim())
    .join(';');
}

// ─── String.prototype.split().join() without reverse() ─
export function ok_split_join(str: string, sep: string) {
  return str.split(sep).join('-');
}

// ─── Array.isArray, Array.from, etc. (other Array methods) ─
export function ok_array_from(iter: Iterable<number>) {
  return Array.from(iter);
}
