// Quarantined repro of the 2026-06 silent-notification incident. Kept in the
// tree on purpose: it is the compiled rule's positive control — Stage 4
// verifies the pattern fires on the real historical shape, not just on a
// synthetic example. Never imported by anything.
export function sendWithRetryLegacy(transport, message) {
  try {
    transport.send(message);
  } catch {}
  return true;
}
