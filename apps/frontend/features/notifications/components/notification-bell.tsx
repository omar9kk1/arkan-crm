'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Role } from '@arkan/shared';
import { Button } from '../../../components/ui/button';
import { Icon } from '../../../components/ui/icon';
import { Toast } from '../../../components/ui/toast';
import { useAuth } from '../../auth/components/auth-provider';
import { NOTIFICATION_PAGE_SIZE, useNotifications } from '../store';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { requestOpenProperty } from '../open-property';
import { notifyPropertyDataChanged } from '../property-refresh';
import styles from './notification-bell.module.css';

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Compact, locale-independent age label rendered inside the panel. */
function formatTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  const elapsed = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return 'الآن';
  if (elapsed < hour) return `قبل ${Math.floor(elapsed / minute)} دقيقة`;
  if (elapsed < day) return `قبل ${Math.floor(elapsed / hour)} ساعة`;
  if (elapsed < 7 * day) return `قبل ${Math.floor(elapsed / day)} يوم`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/**
 * The header notification bell: unread badge, a compact panel of the caller's
 * notifications, mark-as-read, and a click-to-open handler that reuses the
 * properties page's existing details drawer.
 *
 * It reads the shared notification store, so the Notifications page and the bell
 * are always in step and the app keeps a single authenticated 15s poll. There is
 * no browser-notification permission, no WebSocket and no external service.
 */
export function NotificationBell({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id ?? null;
  const { items, unreadCount, status, refresh, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [toastKey, setToastKey] = useState(0);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The newest `createdAt` already surfaced to the user. `seeded` makes sure the
  // very first load (and a reconnect) never pops a toast for existing rows.
  const seeded = useRef(false);
  const lastSeen = useRef<string | null>(null);

  // Drop the previous account's toast state the instant the identity changes.
  useEffect(() => {
    seeded.current = false;
    lastSeen.current = null;
    setOpen(false);
    setToast('');
  }, [userId]);

  // Watch the shared feed for rows newer than the last one surfaced: that is the
  // only moment a toast is shown and the property lists are asked to re-read.
  useEffect(() => {
    const newest = items[0]?.createdAt;
    if (!newest) return;
    if (!seeded.current) {
      seeded.current = true;
      lastSeen.current = newest;
      return;
    }
    const previous = lastSeen.current;
    if (previous !== null && newest <= previous) return;
    const fresh = items.filter(
      (item) => previous === null || item.createdAt > previous,
    );
    lastSeen.current = newest;
    // A `SYSTEM` row never links to a property, so it is the only kind that
    // cannot change a list; everything else means the server data behind the
    // property pages moved and they should re-read themselves.
    if (fresh.some((item) => item.type !== 'SYSTEM')) {
      notifyPropertyDataChanged();
    }
    setToast(
      fresh.length === 1
        ? (fresh[0]?.title ?? 'لديك إشعار جديد')
        : `لديك ${fresh.length} إشعارات جديدة`,
    );
    setToastKey((key) => key + 1);
  }, [items]);

  // Position the popover panel under the bell; close it on an outside click.
  useEffect(() => {
    if (!open) return;
    const popup = panel.current;
    const trigger = anchor.current;
    if (!popup || !trigger) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(380, window.innerWidth - 24);
      const left = Math.max(
        12,
        Math.min(rect.right - width, window.innerWidth - width - 12),
      );
      const top = Math.max(
        12,
        Math.min(rect.bottom + 8, window.innerHeight - 140),
      );
      popup.style.width = `${width}px`;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    try {
      popup.showPopover();
    } catch {
      /* Already open — the browser reports this as a no-op. */
    }
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panel.current?.contains(target) || anchor.current?.contains(target))
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      try {
        popup.hidePopover();
      } catch {
        /* Not open. */
      }
    };
  }, [open]);

  const propertiesRoute =
    user?.role === Role.MANAGER ? '/manager/properties' : '/employee/properties';

  const openNotification = (item: NotificationDto) => {
    setOpen(false);
    // Optimistically flip the row to read (the store persists it and re-syncs on
    // failure); the shared feed updates the bell badge and any open page at once.
    if (!item.read) void markRead(item.id);
    // A notification always links to a property the API re-authorizes on read,
    // so a null `propertyId` simply means "nothing to open".
    if (item.propertyId) {
      requestOpenProperty(item.propertyId);
      router.push(propertiesRoute);
    }
  };

  const markAll = () => {
    void markAllRead();
  };

  // The panel is a compact preview: even if a page has loaded older pages, the
  // bell keeps showing only the newest page.
  const preview = items.slice(0, NOTIFICATION_PAGE_SIZE);

  return (
    <>
      <span ref={anchor} className={styles.anchor}>
        <Button
          className={className}
          aria-label={
            unreadCount > 0
              ? `الإشعارات — ${unreadCount} غير مقروء`
              : 'الإشعارات'
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="bell" />
          {unreadCount > 0 && (
            <span className={styles.badge}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </span>
      <div
        ref={panel}
        popover="manual"
        role="dialog"
        aria-label="الإشعارات"
        className={styles.panel}
      >
        <div className={styles.header}>
          <strong className={styles.headerTitle}>الإشعارات</strong>
          {unreadCount > 0 && (
            <button type="button" className={styles.markAll} onClick={markAll}>
              تحديد الكل كمقروء
            </button>
          )}
        </div>
        <div className={styles.body}>
          {status === 'loading' && preview.length === 0 ? (
            <p className={styles.state}>جارٍ تحميل الإشعارات…</p>
          ) : status === 'error' && preview.length === 0 ? (
            <p className={styles.state}>
              تعذّر تحميل الإشعارات.{' '}
              <button
                type="button"
                className={styles.retry}
                onClick={() => void refresh()}
              >
                إعادة المحاولة
              </button>
            </p>
          ) : preview.length === 0 ? (
            <p className={styles.state}>لا توجد إشعارات</p>
          ) : (
            <ul className={styles.list}>
              {preview.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`${styles.item} ${
                      item.read ? styles.itemRead : styles.itemUnread
                    }`}
                    onClick={() => openNotification(item)}
                  >
                    <span className={styles.itemTop}>
                      <span className={styles.itemTitle}>
                        {!item.read && (
                          <span className={styles.dot} aria-hidden="true" />
                        )}
                        {item.title}
                      </span>
                      <time className={styles.itemTime} dateTime={item.createdAt}>
                        {formatTime(item.createdAt)}
                      </time>
                    </span>
                    <span className={styles.itemMessage}>{item.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Toast message={toast} eventKey={toastKey} onDismiss={() => setToast('')} />
    </>
  );
}
