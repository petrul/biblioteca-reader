/**
 * Accumulates tab-visible reading time for one work (see
 * hooks/useReadingAttention.ts, its one caller). The clock and the
 * visibility check are injected so tests can advance time without waiting.
 */
export class AttentionMeter {
  private seconds = 0;
  private lastTick: number | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly visible: () => boolean = () => document.visibilityState === 'visible'
  ) {}

  // Starts (or restarts) measuring from now - time while hidden is not counted.
  start(): void {
    this.lastTick = this.visible() ? this.now() : null;
  }

  // Credits the time since the last tick if the tab was visible meanwhile;
  // call on every visibility change and before taking.
  tick(): void {
    const now = this.now();
    if (this.lastTick != null) this.seconds += (now - this.lastTick) / 1000;
    this.lastTick = this.visible() ? now : null;
  }

  // Ticks, then hands over the whole seconds accumulated so far, keeping the
  // fractional remainder for the next take.
  takeWholeSeconds(): number {
    this.tick();
    const whole = Math.floor(this.seconds);
    this.seconds -= whole;
    return whole;
  }
}
