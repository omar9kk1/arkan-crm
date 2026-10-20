'use client';

import { useEffect, useRef } from 'react';

/**
 * Scrolls a deep-linked property card into view once it has actually rendered.
 *
 * The target row may arrive after the first fetch (the id is resolved through
 * `GET /properties/:id`, not the page window), so the card must not be scrolled
 * to before it exists. This hook waits for `targetId` to change, then — after a
 * paint so React has mounted the node — looks the node up by its
 * `data-property-id` attribute and scrolls it into view exactly once per target.
 *
 * Nothing here is tied to a specific page: both the manager and employee grids
 * mark their cards with `data-property-id`, so the same behaviour applies.
 */
export function useRevealScroll(targetId: string | null): void {
  const lastScrolled = useRef<string | null>(null);

  useEffect(() => {
    if (!targetId) {
      lastScrolled.current = null;
      return;
    }
    if (lastScrolled.current === targetId) return;
    // The card enters the DOM only after the reveal-driven tab switch and data
    // render commit; one frame can fire before that, so a few bounded attempts
    // wait for the node without polling for long or scrolling to a missing card.
    let attempts = 0;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const findAndScroll = () => {
      const node = document.querySelector<HTMLElement>(
        `[data-property-id="${CSS.escape(targetId)}"]`,
      );
      if (node) {
        lastScrolled.current = targetId;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      attempts += 1;
      if (attempts < 12)
        frame = requestAnimationFrame(() => {
          timer = setTimeout(findAndScroll, 25);
        });
    };
    frame = requestAnimationFrame(findAndScroll);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [targetId]);
}
