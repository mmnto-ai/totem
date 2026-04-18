// Fixture for rule 1c0c5a7daefdeb4b — byte-level string assembly primitives
// used to evade static analysis. Every call site below MUST fire the rule.
// The test harness asserts total match count >= 7 so any one sub-pattern
// regression surfaces via the count dropping below 7.

// ─── (1) String.fromCharCode payload assembly ──────
export function obf_fromCharCode() {
  // 'curl'
  return String.fromCharCode(99, 117, 114, 108);
}

// ─── (2) Buffer.from hex decoding ──────────────────
export function obf_buffer_hex() {
  return Buffer.from('68747470733a2f2f6e67726f6b2e696f', 'hex').toString('utf8');
}

// ─── (3) Buffer.from base64 decoding ───────────────
export function obf_buffer_base64() {
  return Buffer.from('aHR0cHM6Ly9uZ3Jvay5pby9zdGVhbA==', 'base64').toString('utf8');
}

// ─── (4) atob (browser-native base64 decode) ───────
export function obf_atob() {
  const payload: string = null as any;
  return atob(payload);
}

// ─── (5) btoa (browser-native base64 encode) ───────
export function obf_btoa() {
  const payload: string = null as any;
  return btoa(payload);
}

// ─── (6) Numeric-array .map().join() ───────────────
export function obf_map_join() {
  // Byte values for 'wget'.
  return [119, 103, 101, 116].map((c) => String.fromCharCode(c)).join('');
}

// ─── (7) .split().reverse().join() string reversal ─
export function obf_reverse() {
  const hidden = 'oi.korgn//:sptth';
  return hidden.split('').reverse().join('');
}
