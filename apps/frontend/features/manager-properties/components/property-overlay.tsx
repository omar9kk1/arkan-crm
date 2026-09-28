'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '../../../components/ui/button';
import styles from './properties.module.css';
// Native modal dialog supplies focus trapping and Escape handling for both surfaces.
export function PropertyOverlay({
  title,
  drawer = false,
  onClose,
  onCloseButton,
  children,
  className = '',
}: {
  title: string;
  drawer?: boolean;
  onClose: () => void;
  onCloseButton?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    ref.current?.showModal();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      previousFocus?.focus();
    };
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
          )
            ref.current?.close();
        }
      }}
    >
      <header className={styles.overlayHeader}>
        <h2 id={id}>{title}</h2>
        <Button
          onClick={() => {
            onCloseButton?.();
            ref.current?.close();
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
