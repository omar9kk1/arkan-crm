'use client';
import { useEffect, useRef, useState } from 'react';
import {
  STEPPED_COUNT_MAX,
  UNIVERSAL_DURATION_MS,
  startDiscreteCount,
} from './count-up-engine';

/**
 * Count-up for summary statistics — a presentation concern only; the value
 * shown at rest is ALWAYS the real caller value.
 *
 * Contract:
 *  - ONE visible count per mount, and ONE universal duration:
 *      0        → instant, never counted;
 *      1..30    → every intermediate integer in sequence, evenly distributed
 *                 across the UNIVERSAL_DURATION_MS (~2s) — discrete real
 *                 timers on absolute deadlines, NO easing and NO skipping
 *                 (e.g. 6 → 0,1,2,3,4,5,6 completing at ~2s);
 *      >30      → smooth time-based integer progression over the SAME ~2s.
 *  - The step chain survives a hidden tab: timers throttle but never skip,
 *    so every integer still appears ON-screen in order when the user returns
 *    (unlike wall-clock rAF progress, which jumps to near-final).
 *  - Zeros never animate AND never complete the counter: pages fetch data
 *    client-side, so the first render is almost always a pre-data zero —
 *    treating it as a finished cycle would strip the count-up from the real
 *    value arriving right after (the bug that froze every async page).
 *  - Rerenders, background refetches and focus refetches never restart a
 *    running cycle (the effect only re-runs when the value itself changes);
 *    a change AFTER completion applies instantly.
 *  - React StrictMode's dev effect cycle (effect → cleanup → effect) is
 *    harmless: it restarts a FULL 0→value cycle, it can never jump early.
 *  - prefers-reduced-motion → the final value displays immediately (this is
 *    a real system setting; the animation is NOT overridden).
 *  - Integer output; pair with `font-variant-numeric: tabular-nums`.
 */
export function useCountUp(rawValue: number): number {
  // Integers only — statistic counters come from the API as ints.
  const value = Math.round(rawValue);
  const [display, setDisplay] = useState(0);
  /** Whether a cycle ALREADY COMPLETED once — later value changes then apply
   * instantly (no repeated counting), while an IN-FLIGHT cycle is only ever
   * restarted as a whole, never skipped. */
  const completedRef = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(value)) return undefined;

    if (value === 0) {
      // Zero NEVER completes the counter (see contract above): show it
      // instantly, but keep the hook ready to count the real value that
      // follows. A zero AFTER a completed cycle hits this same instant path
      // (completedRef keeps later changes instant — refetches never restart).
      setDisplay(0);
      return undefined;
    }

    const finishImmediately =
      completedRef.current ||
      (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (finishImmediately) {
      completedRef.current = true;
      setDisplay(value);
      return undefined;
    }

    if (value <= STEPPED_COUNT_MAX) {
      // EVERY integer in sequence, evenly distributed across the universal
      // 2s: each step's hold is exactly UNIVERSAL_DURATION_MS / value, so
      // the cycle ALWAYS completes at ~2000ms regardless of the value.
      const cycle = startDiscreteCount(
        value,
        UNIVERSAL_DURATION_MS / value,
        setDisplay,
        () => {
          completedRef.current = true;
          setDisplay(value);
        },
        {
          setTimer: (delay, callback) => window.setTimeout(callback, delay),
          clearTimer: (handle) => window.clearTimeout(handle as number),
          now: () => performance.now(),
        },
      );
      return () => cycle.cancel();
    }

    // >30: smooth ease-out progression over the SAME universal duration.
    let running = true;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (!running) return;
      const progress = Math.min(
        1,
        (now - started) / UNIVERSAL_DURATION_MS,
      );
      // Smooth ease-out increments for large numbers.
      const shown = Math.round(value * (1 - Math.pow(1 - progress, 3)));
      setDisplay(shown);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        running = false;
        completedRef.current = true;
        setDisplay(value);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return display;
}
