/**
 * Centralized 429/rate-limit error detection.
 * Checks error message for common rate-limit indicators across LLM providers.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase(); // totem-ignore #894 — centralized detector
  return msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit');
}

/**
 * Wraps an async function with exponential backoff retry on 429 errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, delayMs: number) => void;
  },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 2000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt);
      opts?.onRetry?.(attempt + 1, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('[Totem Error] Retry loop failed to complete unexpectedly.'); // totem-ignore #894 — dead code guard
}
