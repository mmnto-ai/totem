/**
 * Minimum-interval request pacer (mmnto-ai/totem#2562): awaits until at least
 * `minIntervalMs` has elapsed since the previous paced call, so a sync stays
 * under per-minute provider quotas instead of slamming into them. With
 * `minIntervalMs` <= 0 the pacer is a no-op (zero added latency).
 *
 * One pacer instance paces ONE caller's request stream — embedders hold one
 * per instance, matching their per-run lifecycle.
 */
export function createRequestPacer(minIntervalMs: number): () => Promise<void> {
  if (minIntervalMs <= 0) {
    return () => Promise.resolve();
  }
  let lastRequestAt = 0;
  return async () => {
    const waitMs = lastRequestAt + minIntervalMs - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
  };
}
