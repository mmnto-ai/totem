/**
 * Tracks progress of a batch operation and calculates ETA.
 * Only averages over items that actually took time (not cached/instant ones).
 */
export class ProgressTracker {
  private total: number;
  private completed = 0;
  private startTime: number;
  private activeItemTimes: number[] = []; // durations of non-instant items in ms

  constructor(total: number) {
    this.total = total;
    this.startTime = Date.now();
  }

  /** Record completion of one item. Pass duration in ms to include in ETA average. */
  tick(durationMs?: number): void {
    this.completed++;
    if (durationMs !== undefined && durationMs > 500) {
      // Only count items that took > 500ms (i.e., actual LLM calls, not cached)
      this.activeItemTimes.push(durationMs);
    }
  }

  /** Get formatted progress string: "45/91 (49%) | 1m 12s elapsed | ~2m 5s remaining" */
  format(): string {
    const pct = Math.round((this.completed / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const elapsedStr = formatDuration(elapsed);

    const remaining = this.total - this.completed;
    if (remaining === 0) {
      return `${this.completed}/${this.total} (${pct}%) | ${elapsedStr} elapsed`;
    }

    if (this.activeItemTimes.length === 0) {
      return `${this.completed}/${this.total} (${pct}%) | ${elapsedStr} elapsed | calculating ETA...`;
    }

    const avgMs = this.activeItemTimes.reduce((a, b) => a + b, 0) / this.activeItemTimes.length;
    const etaMs = avgMs * remaining;
    const etaStr = formatDuration(etaMs);

    return `${this.completed}/${this.total} (${pct}%) | ${elapsedStr} elapsed | ~${etaStr} remaining`;
  }

  get completedCount(): number {
    return this.completed;
  }
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}
