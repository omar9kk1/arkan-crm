'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../lib/api/notifications-api';
import type { NotificationDto } from '../../lib/api/notification-types';
import { useAuth } from '../auth/components/auth-provider';

/**
 * The single source of truth for the caller's in-app notifications.
 *
 * The header bell and the manager/employee Notifications PAGES all read from
 * this module-level store, so the whole app runs ONE authenticated 15s poll
 * instead of one per component. Because it is shared, marking a row read in a
 * page updates the bell badge (and vice versa) instantly, with no browser
 * refresh and no duplicate request loop.
 *
 * The store is keyed to the signed-in user: an account switch or a logout
 * clears the previous user's rows and count before the next poll can show them.
 */
export const NOTIFICATION_POLL_MS = 15_000;
export const NOTIFICATION_PAGE_SIZE = 20;

export type NotificationFeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NotificationFeed {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
  status: NotificationFeedStatus;
  loadingMore: boolean;
}

const EMPTY: NotificationFeed = {
  items: [],
  unreadCount: 0,
  nextCursor: null,
  status: 'idle',
  loadingMore: false,
};

let feed: NotificationFeed = EMPTY;
/** The identity the feed belongs to; everything is dropped when it changes. */
let boundUserId: string | null = null;
/** Bumped on every identity change so an in-flight response for the PREVIOUS
 * user can never be published onto the new user's feed. */
let generation = 0;
let inFlight = false;
const listeners = new Set<() => void>();
let refCount = 0;
let timer: number | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function publish(patch: Partial<NotificationFeed>): void {
  feed = { ...feed, ...patch };
  emit();
}

function getSnapshot(): NotificationFeed {
  return feed;
}

/** The server never has a caller's private inbox. */
function getServerSnapshot(): NotificationFeed {
  return EMPTY;
}

function startTimer(): void {
  if (timer !== null) return;
  timer = window.setInterval(() => void refresh(), NOTIFICATION_POLL_MS);
}

function stopTimer(): void {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  refCount += 1;
  if (refCount === 1) {
    startTimer();
    // A remount with an unchanged identity also re-reads once, so a page never
    // shows rows that another tab changed while it was unmounted.
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount === 0) stopTimer();
  };
}

/**
 * Merge a freshly fetched first page into whatever is already loaded, keyed by
 * id. Published rows win (they carry the current read state), rows the page has
 * scrolled past are kept, and the result stays newest-first like the API.
 */
function mergeFirstPage(
  current: readonly NotificationDto[],
  page: readonly NotificationDto[],
): NotificationDto[] {
  const byId = new Map<string, NotificationDto>();
  for (const item of current) byId.set(item.id, item);
  for (const item of page) byId.set(item.id, item);
  return [...byId.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}

/** Re-reads the caller's first page and unread count. Safe to call anytime. */
async function refresh(): Promise<void> {
  if (!boundUserId || inFlight) return;
  inFlight = true;
  const gen = generation;
  try {
    const [page, unread] = await Promise.all([
      listNotifications({ limit: NOTIFICATION_PAGE_SIZE }),
      getUnreadNotificationCount(),
    ]);
    if (gen !== generation) return;
    const items = mergeFirstPage(feed.items, page.items);
    const patch: Partial<NotificationFeed> = {
      items,
      unreadCount: unread.count,
      status: 'ready',
    };
    // Only advance the cursor while the first page is all we hold; once older
    // pages are loaded, the poll must not rewind pagination.
    if (feed.items.length <= page.items.length) patch.nextCursor = page.nextCursor;
    publish(patch);
  } catch {
    if (gen === generation) {
      // Keep whatever is already on screen; only a first load becomes an error.
      publish({ status: feed.status === 'ready' ? 'ready' : 'error' });
    }
  } finally {
    inFlight = false;
  }
}

/** Points the shared feed at the signed-in user, clearing any previous inbox. */
export function bindNotificationUser(userId: string | null): void {
  if (boundUserId === userId) return;
  boundUserId = userId;
  generation += 1;
  inFlight = false;
  publish({
    items: [],
    unreadCount: 0,
    nextCursor: null,
    status: userId ? 'loading' : 'idle',
    loadingMore: false,
  });
  if (userId) void refresh();
}

/** Optimistically marks one row read, then persists; a failure re-syncs. */
async function markRead(id: string): Promise<void> {
  const row = feed.items.find((item) => item.id === id);
  if (row && !row.read) {
    const readAt = new Date().toISOString();
    publish({
      items: feed.items.map((item) =>
        item.id === id ? { ...item, read: true, readAt: item.readAt ?? readAt } : item,
      ),
      unreadCount: Math.max(0, feed.unreadCount - 1),
    });
  }
  try {
    await markNotificationRead(id);
  } catch {
    void refresh();
  }
}

/** Marks every unread row of the caller read, then persists. */
async function markAllRead(): Promise<void> {
  const readAt = new Date().toISOString();
  publish({
    items: feed.items.map((item) => ({
      ...item,
      read: true,
      readAt: item.readAt ?? readAt,
    })),
    unreadCount: 0,
  });
  try {
    await markAllNotificationsRead();
  } catch {
    void refresh();
  }
}

/** Appends the next cursor page, so older notifications stay reachable. */
async function loadMore(): Promise<void> {
  const cursor = feed.nextCursor;
  if (!boundUserId || !cursor || feed.loadingMore) return;
  publish({ loadingMore: true });
  const gen = generation;
  try {
    const page = await listNotifications({
      limit: NOTIFICATION_PAGE_SIZE,
      cursor,
    });
    if (gen !== generation) return;
    publish({
      items: mergeFirstPage(feed.items, page.items),
      nextCursor: page.nextCursor,
    });
  } catch {
    // Keep the rows already on screen.
  } finally {
    if (gen === generation) publish({ loadingMore: false });
  }
}

export interface UseNotificationsResult extends NotificationFeed {
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * Subscribes a component to the shared feed. The bell and both notification
 * pages call this, so they always show the same rows and the same unread count.
 */
export function useNotifications(): UseNotificationsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    bindNotificationUser(userId);
  }, [userId]);
  return { ...snapshot, refresh, markRead, markAllRead, loadMore };
}
