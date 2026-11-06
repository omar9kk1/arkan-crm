'use client';
import { useEffect, useId, useCallback, useRef, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import { Icon } from '../../../components/ui/icon';
import styles from './properties.module.css';

/**
 * Native modal dialog supplies focus trapping and Escape handling for both
 * surfaces. Closing is EVENT-INDEPENDENT: some environments never dispatch
 * the native `close` (or `cancel`) event, which would leave the body lock
 * applied forever and keep the component mounted — the always-firing
 * `toggle` event plus explicit parent callbacks make closing reliable.
 */
export function PropertyOverlay({
  title,
  drawer = false,
  onClose,
  onCloseButton,
  onBack,
  children,
  className = '',
  headerDetails,
  footer,
  guardClose,
  slideFromLeft = false,
}: {
  title: string;
  drawer?: boolean;
  onClose: () => void;
  onCloseButton?: () => void;
  onBack?: () => void;
  children: ReactNode;
  className?: string;
  headerDetails?: ReactNode;
  /**
   * Optional pinned footer rendered BELOW the scrollable body (sibling of
   * it, never inside it): the content scrolls while the actions stay put
   * without ever overlapping what is being read. Omitted → unchanged shell.
   */
  footer?: ReactNode;
  /**
   * Optional dismissal guard (button, Escape and backdrop): returning false
   * KEEPS the drawer open. Used by drawers with unsaved input; callers
   * without it are completely unaffected.
   */
  guardClose?: () => boolean;
  /**
   * Optional EXIT animation for edge-anchored drawers: the overlay slides
   * BACK toward its anchored edge (physical pixels — RTL cannot reverse the
   * transform) before the native close. Off by default: every existing
   * overlay keeps its instant close.
   */
  slideFromLeft?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Latest callback without re-running the mount effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const guardCloseRef = useRef(guardClose);
  useEffect(() => {
    guardCloseRef.current = guardClose;
  }, [guardClose]);
  const slideFromLeftRef = useRef(slideFromLeft);
  useEffect(() => {
    slideFromLeftRef.current = slideFromLeft;
  }, [slideFromLeft]);
  // Latest close helper without re-running the mount effect (the `cancel`
  // listener registered at mount always calls the CURRENT one).
  const closeAnimatedRef = useRef<() => void>(() => undefined);

  // Optional slide-out (button/backdrop/Escape all funnel through here), then
  // the reliable close. Reduced-motion and unsupported environments close
  // instantly; a refused animation never leaves the dialog stuck open.
  const closeAnimated = useCallback(() => {
    const dialog = ref.current;
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      !dialog ||
      !slideFromLeftRef.current ||
      reducedMotion ||
      typeof dialog.animate !== 'function'
    ) {
      dialog?.close();
      // Do not depend on the native close event reaching the parent.
      onClose();
      return;
    }
    let animation: Animation;
    try {
      // `translateX` is PHYSICAL — a LEFT-anchored drawer always exits
      // toward the left edge (negative X), independent of the direction.
      animation = dialog.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }],
        { duration: 180, easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)' },
      );
    } catch {
      dialog.close();
      onClose();
      return;
    }
    animation.finished
      .catch(() => undefined)
      .finally(() => {
        dialog.close();
        onClose();
      });
  }, [onClose]);
  closeAnimatedRef.current = closeAnimated;

  const attemptClose = useCallback(() => {
    if (guardCloseRef.current && !guardCloseRef.current()) return;
    closeAnimated();
  }, [closeAnimated]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    ref.current?.showModal();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const dialog = ref.current;
    // `toggle` fires for BOTH state transitions even when the `close` event
    // is suppressed; when the dialog reports closed by any mechanism
    // (Escape, programmatic close, backdrop) the parent unmounts, and this
    // unmount's cleanup releases the scroll lock.
    const handleToggle = () => {
      if (dialog && !dialog.open) onCloseRef.current?.();
    };
    // Escape goes through `cancel`: a refused guard (`false`) cancels the
    // dismissal, exactly like the button and backdrop paths. Animated
    // drawers intercept here so Escape ALSO slides back to the edge before
    // the real close; classic drawers keep the native instant close.
    const handleCancel = (event: Event) => {
      if (guardCloseRef.current && !guardCloseRef.current()) return;
      if (!slideFromLeftRef.current) return;
      event.preventDefault();
      closeAnimatedRef.current?.();
    };
    dialog?.addEventListener('toggle', handleToggle);
    dialog?.addEventListener('cancel', handleCancel);
    return () => {
      dialog?.removeEventListener('toggle', handleToggle);
      dialog?.removeEventListener('cancel', handleCancel);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      previousFocus?.focus();
    };
    // Mount/unmount only: this effect exists exactly while the overlay is open.
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.overlay} ${drawer ? styles.drawer : styles.modal} ${className}`}
      aria-labelledby={id}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          ) {
            attemptClose();
          }
        }
      }}
    >
      <header className={styles.overlayHeader}>
        {headerDetails ? (
          <div className={styles.overlayTitleGroup}>
            {onBack ? (
              <Button
                onClick={onBack}
                aria-label="رجوع"
                title="رجوع"
                className={styles.overlayBackButton}
              >
                <Icon name="arrowRight" width={16} height={16} />
              </Button>
            ) : null}
            <div>
              <h2 id={id}>{title}</h2>
              {headerDetails}
            </div>
          </div>
        ) : (
          <div className={styles.overlayTitleGroup}>
            {onBack ? (
              <Button
                onClick={onBack}
                aria-label="رجوع"
                title="رجوع"
                className={styles.overlayBackButton}
              >
                <Icon name="arrowRight" width={16} height={16} />
              </Button>
            ) : null}
            <h2 id={id}>{title}</h2>
          </div>
        )}
        <Button
          onClick={() => {
            onCloseButton?.();
            attemptClose();
          }}
          aria-label="إغلاق"
        >
          ×
        </Button>
      </header>
      <div className={styles.overlayBody}>{children}</div>
      {footer ? <div className={styles.overlayFooter}>{footer}</div> : null}
    </dialog>
  );
}
