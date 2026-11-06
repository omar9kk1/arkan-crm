import {
  STEPPED_COUNT_MAX,
  UNIVERSAL_DURATION_MS,
  startDiscreteCount,
  type CountTimers,
} from '../../frontend/components/ui/count-up-engine';

/**
 * Focused fake-timer tests of the REAL count-up scheduling engine under the
 * UNIVERSAL-DURATION policy: EVERY non-zero value (2, 6, 24, …) advances
 * through its intermediate integers evenly distributed across the same
 * ~2000ms interval, so equal-behavior guarantees are measured facts. The
 * hold policy mirrors the hook's own choice: stepHold = 2000 / value.
 */

/** A deterministic manual timer queue (the fake-timer harness). */
class FakeTimers implements CountTimers {
  private currentMs = 0;
  private seq = 0;
  private pending = new Map<number, { at: number; run: () => void }>();

  /** The monotonic clock surfaced to the engine. */
  now(): number {
    return this.currentMs;
  }

  private set current(ms: number) {
    this.currentMs = ms;
  }

  setTimer(delayMs: number, callback: () => void): number {
    this.seq += 1;
    this.pending.set(this.seq, { at: this.currentMs + delayMs, run: callback });
    return this.seq;
  }

  clearTimer(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Runs every timer whose deadline arrived, earliest first, exactly once. */
  advanceTo(targetMs: number): number[] {
    const fired: number[] = [];
    for (;;) {
      const due = [...this.pending.values()].sort((a, b) => a.at - b.at)[0];
      if (!due || due.at > targetMs) break;
      this.current = due.at;
      // Delete the exact entry that is about to run (then run it).
      const id = [...this.pending.entries()].find(
        ([, entry]) => entry === due,
      )?.[0];
      if (id !== undefined) this.pending.delete(id);
      fired.push(due.at);
      due.run();
    }
    this.current = targetMs;
    return fired;
  }
}

/** Runs ONE real engine cycle with the hook's universal hold policy and
 * records each display transition time. */
function renderDisplay(
  value: number,
  timers: FakeTimers,
  transitions: Array<{ at: number; value: number }>,
): void {
  startDiscreteCount(
    value,
    UNIVERSAL_DURATION_MS / value,
    (value) => transitions.push({ value, at: timers.now() }),
    () => undefined,
    timers,
  );
  timers.advanceTo(60000);
}

describe('the universal 2-second count-up policy', () => {
  it('keeps ONE universal duration constant for every value', () => {
    expect(UNIVERSAL_DURATION_MS).toBe(2000);
    expect(STEPPED_COUNT_MAX).toBe(30);
  });

  it('counts 2 across exactly 2s (1 at 1000ms, 2 at 2000ms)', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    renderDisplay(2, timers, transitions);
    expect(transitions).toEqual([
      { at: 1000, value: 1 },
      { at: 2000, value: 2 },
    ]);
  });

  it('counts 6 as 0→1→…→6 completing at approximately 2000ms', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    renderDisplay(6, timers, transitions);
    // The measured progression (real engine, real scheduling code).
    expect(transitions.map((t) => t.value)).toEqual([1, 2, 3, 4, 5, 6]);
    const total = transitions[transitions.length - 1]?.at ?? 0;
    expect(total).toBeCloseTo(2000, 0);
  });

  it('counts 24 through every integer finishing at approximately 2000ms', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    renderDisplay(24, timers, transitions);
    expect(transitions.map((t) => t.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22, 23, 24,
    ]);
    const total = transitions[transitions.length - 1]?.at ?? 0;
    expect(total).toBeCloseTo(2000, 0);
  });

  it('never skips or reorders an intermediate integer', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    renderDisplay(10, timers, transitions);
    expect(transitions.map((t) => t.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('cancelling leaves the display on the last HELD integer (no jump)', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    const onDisplay = (value: number) =>
      transitions.push({ value, at: timers.now() });
    let onCountComplete = 0;
    const cycle = startDiscreteCount(
      6,
      UNIVERSAL_DURATION_MS / 6,
      onDisplay,
      () => {
        onCountComplete += 1;
      },
      timers,
    );
    timers.advanceTo(1000);
    cycle.cancel();
    // No further increments after cancel (step hold = 2000/6 ≈ 333ms, so
    // exactly three integers were held before the cancellation point).
    timers.advanceTo(999999);
    expect(transitions).toHaveLength(3);
    expect(transitions.map((t) => t.value)).toEqual([1, 2, 3]);
    expect(onCountComplete).toBe(0);
  });

  it('fires onComplete exactly once at the REAL final value', () => {
    const timers = new FakeTimers();
    const transitions: Array<{ at: number; value: number }> = [];
    let onCountComplete = 0;
    const cycle = startDiscreteCount(
      4,
      UNIVERSAL_DURATION_MS / 4,
      (value: number) => transitions.push({ value, at: timers.now() }),
      () => {
        onCountComplete += 1;
      },
      timers,
    );
    timers.advanceTo(2000);
    expect(transitions[transitions.length - 1]?.value).toBe(4);
    expect(onCountComplete).toBe(1);
    cycle.cancel();
  });
});
