/**
 * Tracks progress of a batch operation and calculates ETA.
 * Uses throughput-based estimation that naturally accounts for parallel concurrency.
 */
export class ProgressTracker {
  private total: number;
  private completed = 0;
  private startTime: number;

  constructor(total: number) {
    this.total = total;
    this.startTime = Date.now();
  }

  /** Record completion of one item. */
  tick(): void {
    this.completed++;
  }

  /** Get formatted progress string: "45/91 (49%) | 1m 12s elapsed | ~2m 5s remaining" */
  format(): string {
    const pct = this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0;
    const elapsed = Date.now() - this.startTime;
    const elapsedStr = formatDuration(elapsed);

    const remaining = this.total - this.completed;
    if (remaining === 0) {
      return `${this.completed}/${this.total} (${pct}%) | ${elapsedStr} elapsed`;
    }

    if (this.completed === 0 || elapsed === 0) {
      return `${this.completed}/${this.total} (${pct}%) | ${elapsedStr} elapsed | calculating ETA...`;
    }

    // Throughput-based ETA: naturally accounts for parallel concurrency
    const throughput = this.completed / elapsed; // items per ms
    const etaMs = remaining / throughput;
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
