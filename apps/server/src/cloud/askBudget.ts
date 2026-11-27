/** A global cap on model-phrased Ask answers per UTC day (the cloud pays for them). */
export class DailyBudget {
  private day = '';
  private used = 0;

  constructor(
    private readonly cap: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when one more answer fits in today's budget; counts it. */
  take(): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.cap) return false;
    this.used += 1;
    return true;
  }

  get usedToday(): number {
    return this.used;
  }
}
