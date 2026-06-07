/**
 * Deterministic content hashing for run artifacts (mmnto-ai/totem#2100).
 *
 * Node's `JSON.stringify` preserves key insertion order, so two logically
 * identical payloads assembled in different orders would hash differently —
 * breaking content-addressing and the identical-run dedup guarantee. This
 * module canonicalizes (recursive key sort) BEFORE hashing so the content
 * address is a pure function of the logical payload.
 *
 * Array order is deliberately significant — a reordered array is a different
 * payload, not a different spelling of the same one.
 *
 * Scope: plain JSON data only (the artifact is Zod-validated JSON). Cyclic
 * structures throw via `JSON.stringify` — an artifact can never be cyclic, so
 * a cycle here is a caller bug, not an input class to tolerate.
 */

import * as crypto from 'node:crypto';

/**
 * Recursively rebuild a value with object keys in sorted order so the
 * subsequent stringify is canonical. Arrays keep their element order;
 * primitives (and null) pass through untouched.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * sha256 hex (full 64 chars) of the canonical (recursively key-sorted) JSON
 * serialization of `payload`. The full digest — not a truncation — because
 * the hash IS the artifact's filename / identity and must not invite
 * collision shortcuts (contrast `hashManagedBlock`'s display-only 12 chars).
 */
export function calculateDeterministicHash(payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}
