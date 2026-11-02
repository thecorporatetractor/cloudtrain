/*
 * The write cap: a token bucket per Function instance, about 5 writes a second. It is the last
 * limit on cost, behind the sidecar's, for a VM that is breached and calls at full speed. The
 * total is this times the app's maximum instance count, which the infrastructure keeps small.
 */
export class WriteCap {
  private tokens: number;
  private last: number;

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Takes `n` tokens, or none. */
  take(n = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
