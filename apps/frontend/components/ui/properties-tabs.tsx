'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import styles from './properties-tabs.module.css';

/** Guarded capture: synthetic/inactive pointers (tests) must not throw. */
function capturePointer(event: ReactPointerEvent<HTMLElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Ignore: pointer already gone (fast taps) or synthetic event.
  }
}

/**
 * Shared Astra tab list. Base layout (flex-wrap tabs) is untouched for the
 * plain pages; when `wrapperClassName` is supplied (the drawer variant), the
 * pill surface becomes a WRAPPER and the tablist inside it becomes the
 * scroller â€” so the painted scrollbar anchors to the non-scrolling pill and
 * can never drift out of the bar (the native scrollbar is hidden).
 *
 * The painted scrollbar is FULLY FUNCTIONAL: the thumb can be dragged and the
 * track can be clicked to jump, mirroring native scrollbar behavior while
 * staying inside the pill's rounded corners.
 */
export function PropertiesTabs({
  id,
  label,
  items,
  value,
  onChange,
  className = '',
  wrapperClassName = '',
}: {
  id: string;
  label: string;
  items: readonly { id: string; label: string; count?: number }[];
  className?: string;
  /** Pill-surface wrapper (scrollable drawer variant); empty = plain tabs. */
  wrapperClassName?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Live scroll state driving the painted INSIDE-the-bar scrollbar. */
  const [scroll, setScroll] = useState({
    overflow: false,
    /** Visible width / total width (thumb size). */
    fraction: 1,
    /** 0 = at the inline-start edge; 1 = fully scrolled to the other edge. */
    progress: 0,
  });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) {
      setScroll((prev) =>
        prev.overflow ? { overflow: false, fraction: 1, progress: 0 } : prev,
      );
      return;
    }
    setScroll({
      overflow: true,
      fraction: Math.min(1, el.clientWidth / el.scrollWidth),
      // RTL scrolls negative (Chrome): |scrollLeft| moves the thumb from the
      // inline-start edge (right in RTL) toward the other side â€” identical
      // mapping in LTR thanks to the logical `inset-inline-start`.
      progress: Math.abs(el.scrollLeft) / max,
    });
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, items, value]);

  // RTL drawers with narrow width: an overflowing tab bar scrolls HORIZONTALLY
  // inside its own container, but the browser never auto-reveals the selected
  // tab, so the active tab (and its gold highlight) could sit clipped beyond
  // the drawer's left edge. Revealing the selected button after every value
  // change keeps the gold state aligned and every tab reachable; 'instant'
  // bypasses the CSS smooth animation so the reveal is immediate regardless
  // of any pending smooth scrolls. When all tabs fit, this is a no-op.
  useEffect(() => {
    const index = items.findIndex((item) => item.id === value);
    const selected = refs.current[index];
    selected?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
  }, [items, value]);

  /** Apply a logical 0..1 scroll progress to the scroller (RTL-aware). */
  const setProgress = useCallback((progress: number) => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const clamped = Math.min(1, Math.max(0, progress));
    el.scrollLeft = rtl ? -clamped * max : clamped * max;
  }, []);

  // Painted-scrollbar drag state: anchored at pointer-down so the thumb follows
  // the pointer 1:1 (divided by the scrollable span within the track).
  const drag = useRef<{
    pointerId: number;
    startClientX: number;
    startProgress: number;
    span: number;
    /** +1 in LTR, -1 in RTL â€” converts client-delta to progress delta. */
    dir: 1 | -1;
  } | null>(null);

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    // Instant response while interacting: the scroller's CSS smooth behavior
    // would otherwise lag/merge every drags' scrollLeft assignment.
    el.style.scrollBehavior = 'auto';
    const rect = event.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const thumb = Math.max(1, rect.width * scroll.fraction);
    const span = Math.max(1, rect.width - thumb);
    const dir = rtl ? -1 : 1;
    const visualStart = rtl ? rect.right : rect.left;
    let startProgress = scroll.progress;
    if (event.target !== event.currentTarget) {
      // Thumb press: grab relative to the current position (no jump).
      capturePointer(event);
    } else {
      // Track press: jump the thumb under the pointer (no animation), then drag.
      startProgress = Math.min(
        1,
        Math.max(0, (dir * (event.clientX - visualStart) - thumb / 2) / span),
      );
      setProgress(startProgress);
      capturePointer(event);
    }
    drag.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startProgress,
      span,
      dir,
    };
    event.preventDefault();
  };

  const onTrackPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const delta = (event.clientX - state.startClientX) * state.dir;
    setProgress(state.startProgress + delta / state.span);
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    // Restore the component's smooth behavior for future selection scrolls.
    listRef.current?.style.removeProperty('scroll-behavior');
  };

  const buttons = () =>
    items.map((item, index) => (
      <button
        key={item.id}
        ref={(element) => {
          refs.current[index] = element;
        }}
        type="button"
        role="tab"
        id={`${id}-tab-${item.id}`}
        aria-controls={`${id}-panel-${item.id}`}
        aria-selected={value === item.id}
        tabIndex={value === item.id ? 0 : -1}
        onClick={() => {
          // Clicking an ALREADY-selected but partially hidden tab must reveal
          // it too (value unchanged => no effect): reveal instantly here.
          onChange(item.id);
          refs.current[index]?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'instant',
          });
        }}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowLeft') next = (index + 1) % items.length;
          else if (event.key === 'ArrowRight')
            next = (index - 1 + items.length) % items.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = items.length - 1;
          else return;
          event.preventDefault();
          const nextItem = items[next];
          if (!nextItem) return;
          onChange(nextItem.id);
          refs.current[next]?.focus();
        }}
      >
        {item.label}
        {item.count !== undefined && <span>{item.count}</span>}
      </button>
    ));

  if (!wrapperClassName) {
    // Plain (non-scrolling) usage: identical DOM to the original component â€”
    // a bare tablist carrying the caller's className.
    return (
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className={`${styles.tabs} ${className}`}
      >
        {buttons()}
      </div>
    );
  }

  const thumbWidth = Math.max(18, scroll.fraction * 100);

  return (
    <div className={wrapperClassName}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className={`${styles.tabs} ${styles.scroller}`}
      >
        {buttons()}
      </div>
      {scroll.overflow && (
        // A REAL, INTERACTIVE scrollbar anchored to the STATIC pill wrapper
        // (not the scroller): the thumb can be dragged and the track jumped,
        // exactly like a native scrollbar â€” but it paints INSIDE the pill's
        // rounded corners, which native scrollbars never respect.
        <span
          className={styles.scrollTrack}
          aria-hidden="true"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span
            className={styles.scrollThumb}
            style={
              {
                inlineSize: `${thumbWidth}%`,
                insetInlineStart: `${scroll.progress * (100 - thumbWidth)}%`,
                position: 'absolute',
              } as CSSProperties
            }
          />
        </span>
      )}
    </div>
  );
}
