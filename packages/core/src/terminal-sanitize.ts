/**
 * Dependency-light terminal-injection defense.
 *
 * Strips ANSI/control bytes from text that originated in untrusted sources
 * (GitHub review content, on-disk substrate files, etc.) before it lands
 * in a `log.*` call. Per CR mmnto-ai/totem#1734 R2 + mmnto-ai/totem#1739
 * R2: raw text printed without sanitization is a terminal-injection
 * vector — a hostile reviewer or a tampered substrate can plant CSI
 * sequences that spoof cursor moves or color resets.
 *
 * Removes:
 * - CSI sequences (ESC `[` … final byte): the standard ANSI escape form.
 * - C0 control bytes other than `\n` and `\t`. `\r` (CR, `\x0d`) is also
 *   stripped because a bare CR rewinds the cursor and overwrites the
 *   current terminal line — exactly the surface this defense exists to
 *   close. Per CR mmnto-ai/totem#1739 R3 (Critical).
 * - C1 control bytes `\x80-\x9f`: 8-bit control-sequence variants per
 *   ECMA-48; CR mmnto-ai/totem#1739 R2 caught the original regex
 *   stopped at `\x7f`.
 *
 * **No imports.** Pure synchronous string manipulation — adding deps
 * here would pull them transitively into every `@mmnto/totem` consumer.
 * Originally landed in `@mmnto/cli` per CR mmnto-ai/totem#1739 R2 to
 * keep the pattern-history overlay on `--estimate` off the orchestrator
 * graph; promoted to `@mmnto/totem` core in mmnto-ai/totem#1744 so MCP
 * and other downstream consumers can use it without taking a CLI dep.
 */
// totem-context: regex char-class with hex escapes targets specific control bytes — not the unbounded `.*` quantifier the ReDoS rule flags
export function sanitizeForTerminal(value: string): string {
  return (
    value
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // \x09 (HT) and \x0a (LF) are intentionally preserved — they fall in
      // the gaps between \x08 and \x0b. \x0d (CR) is in the strip range:
      // a bare CR rewinds the cursor (CR mmnto-ai/totem#1739 R3 Critical).
      .replace(/[\x00-\x08\x0b-\x0d\x0e-\x1f\x7f-\x9f]/g, ' ')
  );
}
