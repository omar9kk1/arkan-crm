'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { Icon } from '../../../components/ui/icon';
import { Toast } from '../../../components/ui/toast';
import { useAuth } from '../../auth/components/auth-provider';
import { NOTIFICATION_PAGE_SIZE, useNotifications } from '../store';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { notificationRoute } from '../notification-target';
import { notifyClientsDataChanged } from '../clients-refresh';
import {
  DUPLICATE_NOTIFICATION_MESSAGE,
  DUPLICATE_NOTIFICATION_TITLE,
  duplicateNotificationDetails,
  isDecisionNotification,
  isPotentialDuplicateNotification,
  isRecordNotification,
  notificationAffectsPropertyLists,
  resolvePropertyCode,
  stripInternalIds,
} from '../view';
import { notifyPropertyDataChanged } from '../property-refresh';
import styles from './notification-bell.module.css';

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

// ---------------------------------------------------------------------------
// Presentation-only reading of a stored notification body.
//
// The backend writes property bodies in one known shape
// (`رقم العقار: <code> — التعديلات: <label (old ← new)>، …`). The bell turns
// that shape into readable lines; ANY body that does not match it exactly —
// including every older notification, record-activity and system rows — is
// displayed as its plain stored text with safe wrapping. Nothing is re-parsed
// for meaning, nothing is sent anywhere and the stored history is untouched.
// ---------------------------------------------------------------------------

const PROPERTY_BODY_PREFIX = 'رقم العقار: ';
const CHANGES_SEPARATOR = ' — التعديلات: ';
const SUMMARY_ITEM_SEPARATOR = '، ';

/** One changed field, read from a single summary item. */
export interface NotificationChangeLine {
  /** The field label, e.g. «المنطقة» or «الدور الأرضي — التفاصيل». */
  label: string;
  /** The value before the change, when the item reports a value change. */
  before: string | null;
  /** The value after the change, when the item reports a value change. */
  after: string | null;
  /** An optional free-text note shown after the label. */
  note: string | null;
  /** The item's stored text, unchanged — the safe fallback for any line. */
  text: string;
}

/** The display model of one stored body, used only by the bell panel. */
export interface NotificationBodyPreview {
  /** The body is a property event body in the known generated shape. */
  isProperty: boolean;
  /** Per-field change lines, or null when the body has none to show. */
  changes: NotificationChangeLine[] | null;
}

/** Reads a value-change detail (`old ← new`); anything else stays a note. */
const VALUE_PAIR = /^([^←]+) ← ([^←]+)$/;

function parseChangeItem(rawItem: string): NotificationChangeLine {
  const text = rawItem.trim();
  // The trailing `label (detail)` of the generated grammar. A detail that
  // itself contains parentheses never matches — such an item falls back to
  // its stored text instead of being reinterpreted.
  const shaped = /^(.+?) \(([^()]*)\)$/.exec(text);
  const label = (shaped ? (shaped[1] ?? text) : text).trim();
  const detail = shaped ? (shaped[2] ?? '').trim() : null;
  const pair = detail ? VALUE_PAIR.exec(detail) : null;
  return {
    label: label || text,
    before: pair ? (pair[1] ?? '').trim() : null,
    after: pair ? (pair[2] ?? '').trim() : null,
    note: pair ? null : detail,
    text,
  };
}

export function parseNotificationBody(
  message: string,
): NotificationBodyPreview {
  if (!message.startsWith(PROPERTY_BODY_PREFIX)) {
    return { isProperty: false, changes: null };
  }
  const marker = message.indexOf(CHANGES_SEPARATOR);
  if (marker === -1) return { isProperty: true, changes: null };
  const summary = message.slice(marker + CHANGES_SEPARATOR.length);
  const changes = summary
    .split(SUMMARY_ITEM_SEPARATOR)
    .filter((rawItem) => rawItem.trim().length > 0)
    .map(parseChangeItem);
  return { isProperty: true, changes: changes.length ? changes : null };
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

function notificationIcon(
  type: string,
): 'bell' | 'checkCircle' | 'megaphone' | 'clock' | 'settings' {
  if (type.startsWith('PROPERTY_APPROVED') || type === 'CLIENT_REVIEW_APPROVED')
    return 'checkCircle';
  if (type === 'SYSTEM') return 'megaphone';
  if (type.startsWith('FOLLOWUP')) return 'clock';
  if (type.startsWith('PROPERTY')) return 'settings';
  return 'bell';
}

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
    // Any notification linked to a property (including the SYSTEM soft-delete
    // decision) means the server data behind the property pages moved; those
    // pages re-read themselves through their own hook.
    if (fresh.some(notificationAffectsPropertyLists)) {
      notifyPropertyDataChanged();
    }
    // Record-activity rows (clients/contacts/follow-ups/interests) also move
    // the data behind the already-open companies/clients pages — publish the
    // shared refresh signal so those pages refetch through their own hook
    // without a page reload.
    if (fresh.some((item) => isRecordNotification(item.type))) {
      notifyClientsDataChanged();
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

  const openNotification = (item: NotificationDto) => {
    setOpen(false);
    // A decision row whose property was permanently deleted keeps its history
    // in the inbox (the FK is detached) and explains why it cannot open.
    if (isDecisionNotification(item) && !item.propertyId) {
      if (!item.read) void markRead(item.id);
      setToast('تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.');
      setToastKey((key) => key + 1);
      return;
    }
    // Optimistically flip the row to read (the store persists it and re-syncs on
    // failure); the shared feed updates the bell badge and any open page at once.
    if (!item.read) void markRead(item.id);
    // The route is derived ONLY from the authorized references the API echoes
    // back (property / client / contact) — an unusable row simply does nothing.
    const target = notificationRoute(item, user?.role);
    if (target) router.push(target.path);
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
              {preview.map((item) => {
                // The CURRENT property code (the pill) comes from the API,
                // never from the stored historic text; the message itself is
                // ALSO shown with current codes by resolvePropertyCode.
                const isDuplicate =
                  isPotentialDuplicateNotification(item);
                const displayTitle = isDuplicate
                  ? DUPLICATE_NOTIFICATION_TITLE
                  : item.title;
                const duplicateDetails = isDuplicate
                  ? duplicateNotificationDetails(item)
                  : [];
                const surface = isDuplicate
                  ? { isProperty: false, changes: null }
                  : parseNotificationBody(
                      resolvePropertyCode(item.message, item.propertyReference),
                    );
                const showPill =
                  !isDuplicate && surface.isProperty && item.propertyReference;
                const showChanges =
                  !isDuplicate && showPill && surface.changes;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`${styles.item} ${
                        item.read ? styles.itemRead : styles.itemUnread
                      }`}
                      onClick={() => openNotification(item)}
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        <Icon
                          name={notificationIcon(item.type)}
                          width={15}
                          height={15}
                        />
                      </span>
                      <div className={styles.itemContent}>
                        <span className={styles.itemTop}>
                          <span className={styles.itemTitle}>
                            {!item.read && (
                              <span className={styles.dot} aria-hidden="true" />
                            )}
                            {displayTitle}
                          </span>
                          <time
                            className={styles.itemTime}
                            dateTime={item.createdAt}
                          >
                            {formatTime(item.createdAt)}
                          </time>
                        </span>
                        {isDuplicate ? (
                          <>
                            <span className={styles.itemMessage}>
                              {DUPLICATE_NOTIFICATION_MESSAGE}
                            </span>
                            {duplicateDetails.length > 0 && (
                              <span className={styles.duplicateDetails}>
                                {duplicateDetails.map((detail) => (
                                  <span
                                    key={detail.label}
                                    className={styles.duplicateRow}
                                  >
                                    <span className={styles.duplicateLabel}>
                                      {detail.label}
                                    </span>
                                    {detail.code ? (
                                      <bdi className={styles.duplicateCode}>
                                        {detail.value}
                                      </bdi>
                                    ) : (
                                      <span className={styles.duplicateValue}>
                                        {detail.value}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </span>
                            )}
                          </>
                        ) : showPill ? (
                          <span className={styles.itemCode}>
                            <bdi>{item.propertyReference}</bdi>
                          </span>
                        ) : null}
                        {!isDuplicate && showChanges && (
                          <span className={styles.itemChanges}>
                            {surface.changes?.map((line, index) => (
                              <span key={index} className={styles.itemChange}>
                                {line.before !== null && line.after !== null ? (
                                  <>
                                    {line.label}: <bdi>{line.before}</bdi>
                                    {' ← '}
                                    <bdi>{line.after}</bdi>
                                  </>
                                ) : line.note ? (
                                  `${line.label}: ${line.note}`
                                ) : (
                                  line.text
                                )}
                              </span>
                            ))}
                          </span>
                        )}
                        {!isDuplicate && !showPill && !showChanges && (
                          <span className={styles.itemMessage}>
                            {stripInternalIds(
                              resolvePropertyCode(
                                item.message,
                                item.propertyReference,
                              ),
                            )}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <Toast
        message={toast}
        eventKey={toastKey}
        onDismiss={() => setToast('')}
      />
    </>
  );
}
