'use client';
import { useEffect, useRef } from 'react';
import styles from './toast.module.css';

export function Toast({
  message,
  onDismiss,
  eventKey,
}: {
  message: string;
  onDismiss: () => void;
  eventKey?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!message) return;
    const element = ref.current;
    element?.showPopover();
    const timer = window.setTimeout(() => dismiss.current(), 3500);
    return () => {
      window.clearTimeout(timer);
      element?.hidePopover();
    };
  }, [message, eventKey]);
  return (
    <div
      ref={ref}
      popover="manual"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={styles.toast}
    >
      {message}
    </div>
  );
}
