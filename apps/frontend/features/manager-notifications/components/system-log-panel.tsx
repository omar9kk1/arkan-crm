'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Role } from '@arkan/shared';
import { listSystemLog } from '../../../lib/api/system-log-api';
import type {
  SystemLogDetailsRefDto,
  SystemLogEntryDto,
  SystemLogPartyDto,
} from '../../../lib/api/system-log-types';
import { SystemLogDetailsDrawer } from './system-log-details-drawer';
import styles from './notifications.module.css';

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-KW', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kuwait',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function partyLabel(party: SystemLogPartyDto): string {
  if (party.role === Role.OWNER) return `مالك النظام ${party.name}`;
  if (party.role === Role.MANAGER) return `المدير ${party.name}`;
  return party.name;
}

function entityLabel(entry: SystemLogEntryDto): string | null {
  if (!entry.entity) return null;
  const value = entry.entity.code ?? entry.entity.name;
  return `${entry.entity.label}${value ? ` · ${value}` : ''}`;
}

/**
 * OWNER-only system activity log, rendered as a tab inside the existing
 * Notifications page. Rows come from the real AuditLog; this panel never
 * fabricates or duplicates events.
 */
export function SystemLogPanel() {
  const [items, setItems] = useState<SystemLogEntryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<SystemLogDetailsRefDto | null>(null);

  const load = async (cursor?: string, append = false) => {
    if (!append) setStatus('loading');
    else setLoadingMore(true);
    try {
      const page = await listSystemLog({ limit: 50, cursor });
      setItems((previous) =>
        append ? [...previous, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor);
      setStatus('ready');
    } catch {
      if (!append) {
        setItems([]);
        setNextCursor(null);
        setStatus('error');
      }
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void listSystemLog({ limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setNextCursor(null);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <Card>
        <p role="status">جارٍ تحميل سجل النظام...</p>
      </Card>
    );
  }

  if (status === 'error') {
    return (
      <Card>
        <p role="alert">تعذر تحميل سجل النظام.</p>
        <Button onClick={() => void load()}>إعادة المحاولة</Button>
      </Card>
    );
  }

  if (!items.length) {
    return (
      <Card>
        <p>لا توجد أحداث إدارية مسجلة بعد.</p>
      </Card>
    );
  }

  return (
    <div className={styles.logList}>
      {items.map((entry) => (
        <Card
          key={entry.id}
          className={`${styles.logCard} ${entry.details ? styles.logCardClickable : ''}`}
          role={entry.details ? 'button' : undefined}
          tabIndex={entry.details ? 0 : undefined}
          aria-label={
            entry.details ? `عرض تفاصيل: ${entry.title}` : undefined
          }
          onClick={
            entry.details ? () => setSelected(entry.details) : undefined
          }
          onKeyDown={
            entry.details
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(entry.details);
                  }
                }
              : undefined
          }
        >
          <div>
            <h3>{entry.title}</h3>
            <p className={styles.logDescription}>{entry.description}</p>
            <div className={styles.badges}>
              <span className={styles.badge}>{partyLabel(entry.actor)}</span>
              {entityLabel(entry) && (
                <span className={styles.badge}>{entityLabel(entry)}</span>
              )}
              {entry.details && (
                <span className={styles.badge}>عرض التفاصيل</span>
              )}
            </div>
          </div>
          <div className={styles.logMeta}>
            <time dateTime={entry.createdAt}>
              {formatDate(entry.createdAt)}
            </time>
            {entry.recipients.length > 0 && (
              <p className={styles.logRecipients}>
                إلى:{' '}
                {entry.recipients.map((recipient) => partyLabel(recipient)).join('، ')}
              </p>
            )}
          </div>
        </Card>
      ))}
      {nextCursor && (
        <div className={styles.pagination}>
          <Button
            disabled={loadingMore}
            onClick={() => void load(nextCursor, true)}
          >
            {loadingMore ? 'جارٍ التحميل...' : 'تحميل المزيد'}
          </Button>
        </div>
      )}
      {selected && (
        <SystemLogDetailsDrawer
          details={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
