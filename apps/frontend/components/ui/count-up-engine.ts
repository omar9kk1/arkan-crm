/**
 * The scheduling engine of the statistics count-up (NO React, NO wall-clock
 * easing): small values are counted DISCRETELY — the display advances by
 * exactly ONE integer at a time, each step HELD for ~1.2s, timers chained
 * against absolute deadlines (drift-free, and a hidden tab throttles the
 * timer but never SKIPS a step).
 *
 * The timers are injected so focused fake-timer tests can drive the REAL
 * engine and record the timestamp of every transition.
 */

/** EVERY non-zero count-up completes in EXACTLY this duration (ms),
 * regardless of the final value — one consistent speed app-wide
 * (2 → 2s, 6 → 2s, 24 → 2s, 100 → 2s). Intermediate values are distributed
 * evenly across this interval; there are no value-based duration ranges. */
export const UNIVERSAL_DURATION_MS = 2000;

/** Values ≤ this show EVERY intermediate integer in sequence (discrete
 * timers evenly distributed across the universal duration); above it the
 * count progresses as a smooth time-based integer progression over the
 * SAME universal duration. */
export const STEPPED_COUNT_MAX = 30;

export interface CountTimers {
  /** Schedules `callback` after `delayMs`; returns a cancellable handle. */
  setTimer(delayMs: number, callback: () => void): unknown;
  clearTimer(handle: unknown): void;
  /** The monotonic clock (ms) all deadlines are measured on. */
  now(): number;
}

export interface DiscreteCountResult {
  /** Cancels the pending step (a later restart is always a FULL restart). */
  cancel(): void;
}

/**
 * Runs ONE discrete cycle 0 → `target`: every display value is held
 * `stepHoldMs`, the FIRST increment fires exactly once `stepHoldMs` elapsed,
 * and `onComplete` fires the moment the REAL target is reached. Never skips
 * an integer, never computes an eased intermediate.
 */
export function startDiscreteCount(
  target: number,
  stepHoldMs: number,
  onDisplay: (value: number) => void,
  onComplete: () => void,
  timers: CountTimers,
): DiscreteCountResult {
  let step = 0;
  let handle: unknown = null;
  let cancelled = false;
  const cycleStartedAt = timers.now();

  const advance = () => {
    if (cancelled) return;
    step += 1;
    onDisplay(step);
    if (step >= target) {
      onComplete();
      return;
    }
    // HOLD: the next increment (display step+1) fires on the absolute
    // deadline (cycle start + (step+1) × hold) — immune to setTimeout drift
    // and to hidden-tab throttling.
    const nextAt = cycleStartedAt + (step + 1) * stepHoldMs;
    handle = timers.setTimer(Math.max(0, nextAt - timers.now()), advance);
  };

  handle = timers.setTimer(stepHoldMs, advance);
  return {
    cancel() {
      cancelled = true;
      if (handle !== null) timers.clearTimer(handle);
      handle = null;
    },
  };
}
