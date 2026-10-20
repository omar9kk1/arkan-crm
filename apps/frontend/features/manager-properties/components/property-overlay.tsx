'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
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
  children,
  className = '',
  headerDetails,
}: {
  title: string;
  drawer?: boolean;
  onClose: () => void;
  onCloseButton?: () => void;
  children: ReactNode;
  className?: string;
  headerDetails?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Latest callback without re-running the mount effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
    dialog?.addEventListener('toggle', handleToggle);
    return () => {
      dialog?.removeEventListener('toggle', handleToggle);
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
            ref.current?.close();
            // Do not depend on the native close event reaching the parent.
            onClose();
          }
        }
      }}
    >
      <header className={styles.overlayHeader}>
        {headerDetails ? (
          <div>
            <h2 id={id}>{title}</h2>
            {headerDetails}
          </div>
        ) : <h2 id={id}>{title}</h2>}
        <Button
          onClick={() => {
            onCloseButton?.();
            ref.current?.close();
            // Do not depend on the native close event reaching the parent.
            onClose();
          }}
          aria-label="إغلاق"
        >
          ×
        </Button>
      </header>
      <div className={styles.overlayBody}>{children}</div>
    </dialog>
  );
}
