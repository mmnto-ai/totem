// ─── The LF-image primitive, single-homed at a LEAF ──────────────────────────
//
// Two distinct hash-material edges normalize newlines the same way — the ADR-112
// §8 authoring-ledger's `authoringContentHash` material and Prop 310 § Design 10's
// example-pair hash (Amendment 1 item 3's "different edge" note distinguishes the
// CALL SITES, not the normalizer). Tenet 20 says they share the primitive rather
// than mirroring it.
//
// It lives in its OWN module, not beside either caller, purely for the module
// graph: `authoring-ledger.ts` builds its Zod schemas from `authored-rule.ts` at
// top level, and since Prop 310 slice 3 `authored-rule.ts` builds ITS schemas from
// `rule-record.ts`. Had `rule-record.ts` kept importing the normalizer from the
// ledger, that would close a runtime cycle whose top-level Zod construction hits a
// TDZ `ReferenceError` depending only on which module an entry point loads first —
// a latent, import-order-dependent crash. A leaf with no imports of its own cannot
// participate in one. `authoring-ledger.ts` re-exports the symbol, so every
// existing import path and the package barrel are unchanged.

/**
 * Recursively LF-normalize every string in a value. Keeps material-hash
 * determinism SINGLE-HOMED in the hash (Tenet-20, gemini diff-review): a hash
 * built on this is CRLF-invariant regardless of whether the caller pre-normalized,
 * so a future caller cannot silently produce a divergent hash by passing
 * un-normalized CRLF input.
 */
export function lfDeepNormalize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n');
  if (Array.isArray(value)) return value.map(lfDeepNormalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, lfDeepNormalize(v)]),
    );
  }
  return value;
}
