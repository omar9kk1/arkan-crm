'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { SearchBar } from '../../../components/ui/search-bar';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { tabs, filterProperties, type Property } from '../model';
import { listProperties, getProperty } from '../../../lib/api/properties-api';
import { mapPropertyFromApi } from '../../../lib/property-adapter';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import { EmployeePropertyCard } from './employee-property-card';
import { EmployeePropertyDetailsDrawer } from './employee-property-details-drawer';
import {
  consumeOpenProperty,
  useOpenPropertyRequest,
} from '../../notifications/open-property';
import { usePropertyRefreshSignal } from '../../notifications/property-refresh';
import { AddPropertyModal } from './add-property-modal';
import { useAuth } from '../../auth/components/auth-provider';
import common from '../../employee-clients/components/clients.module.css';
import styles from './properties.module.css';
import shared from '../../manager-properties/components/properties.module.css';

const PAGE_SIZE = 50;

export function EmployeePropertiesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Property[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Property | null>(null);
  const [form, setForm] = useDraftState<{ property?: Property } | null>(
    'ui:features/employee-properties/components/employee-properties-page.tsx:form',
    null,
  );
  const [notice, setNotice] = useState('');
  // Monotonic id: a late response can never overwrite a newer load.
  const requestId = useRef(0);
  // Set by a notification-driven re-read so it can update in the background.
  const silentRef = useRef(false);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  // The notification poll re-reads this list whenever it learns of a genuinely
  // new property notification, so the OTHER user's screen updates without a
  // browser refresh. It goes through `refetch`, so it reuses the existing
  // request guard, tab filtering and counts, and it can never loop: this list
  // publishes nothing back.
  const refreshSignal = usePropertyRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    silentRef.current = true;
    refetch();
  }, [refreshSignal, refetch]);

  // Opens the property a notification deep-linked to, using the EXISTING details
  // drawer. The backend re-authorizes the property on read, so a stale link
  // answers 404 and is reported instead of opening an empty drawer.
  const openRequest = useOpenPropertyRequest();
  useEffect(() => {
    if (!openRequest || !user) return;
    const propertyId = openRequest.propertyId;
    let cancelled = false;
    (async () => {
      try {
        const dto = await getProperty(propertyId);
        if (cancelled) return;
        setSelected(mapPropertyFromApi(dto, user));
      } catch (cause) {
        if (cancelled) return;
        setNotice(
          cause instanceof Error ? cause.message : 'تعذّر فتح العقار.',
        );
      } finally {
        consumeOpenProperty(propertyId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openRequest, user]);

  useEffect(() => {
    const id = ++requestId.current;
    // A notification-driven re-read is SILENT: the rows already on screen stay
    // until the fresh ones replace them, so the panel never blinks away.
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    listProperties({ limit: PAGE_SIZE })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems(
          page.items.map((dto: PropertyViewDto) => mapPropertyFromApi(dto, user)),
        );
        setNextCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        if (silent) {
          // Keep the rows on screen; the next poll retries.
          setLoading(false);
          return;
        }
        setItems([]);
        setNextCursor(null);
        setLoading(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل العقارات من الخادم.',
        );
      });
  }, [nonce, user]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    listProperties({ limit: PAGE_SIZE, cursor: nextCursor })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((previous) => [
          ...previous,
          ...page.items.map((dto: PropertyViewDto) =>
            mapPropertyFromApi(dto, user),
          ),
        ]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadingMore(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل المزيد من العقارات.',
        );
      });
  }, [nextCursor, loadingMore, user]);

  const visible = filterProperties(items, tab, query);
  const regions = [...new Set(visible.map((p) => p.region))].filter(Boolean);

  return (
    <EmployeePageShell
      title="العقارات"
      description="إدارة العقارات التي أضفتها أو المخصصة لك للتركيز على التسويق أو متابعة المالك."
      actions={
        <Button onClick={() => setForm({})} disabled={!user}>
          إضافة عقار
        </Button>
      }
    >
      <div className={`${common.toolbar} ${styles.toolbar}`}>
        <div className={styles.tabFrame}>
          <SegmentedTabs
            id="employee-properties"
            label="فلترة العقارات"
            items={tabs.map((item) => ({
              ...item,
              // The count uses the SAME rule as the panel filter. It is shown
              // only when the full set is loaded (no pending cursor and not
              // mid-request): while a cursor is live the loaded set is a
              // partial view, so a count would be a lower bound masquerading
              // as a total.
              count:
                !loading && nextCursor === null
                  ? filterProperties(items, item.id, '').length
                  : undefined,
            }))}
            value={tab}
            onChange={setTab}
          />
        </div>
        <SearchBar
          label="بحث العقارات"
          placeholder="ابحث بالمنطقة أو الكود أو اسم العقار..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <Card role="status" aria-live="polite">
          جارٍ تحميل العقارات…
        </Card>
      ) : error ? (
        <Card>
          <h2>تعذر تحميل العقارات</h2>
          <p>{error}</p>
          <Button type="button" onClick={refetch}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card>لم يسجّل الخادم أي عقار حتى الآن.</Card>
      ) : (
        <>
          {tabs.map((t) => (
            <section
              key={t.id}
              role="tabpanel"
              id={`employee-properties-panel-${t.id}`}
              aria-labelledby={`employee-properties-tab-${t.id}`}
              hidden={tab !== t.id}
              tabIndex={0}
            >
              {tab === t.id && (
                <>
                  {regions.map((region) => (
                    <section key={region} className={styles.region}>
                      <h2>{region}</h2>
                      <div className={`${shared.scope} ${shared.propertyGrid}`}>
                        {visible
                          .filter((p) => p.region === region)
                          .map((p) => (
                            <EmployeePropertyCard
                              key={p.id}
                              property={p}
                              onOpen={() => setSelected(p)}
                            />
                          ))}
                      </div>
                    </section>
                  ))}
                  {!visible.length && (
                    <Card>لا توجد عقارات تطابق البحث والفلاتر.</Card>
                  )}
                </>
              )}
            </section>
          ))}
          {nextCursor && (
            <div className={styles.loadMore}>
              <Button
                type="button"
                variant="ghost"
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
              </Button>
            </div>
          )}
        </>
      )}

      {selected && (
        <EmployeePropertyDetailsDrawer
          property={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setForm({ property: selected });
            setSelected(null);
          }}
        />
      )}
      {form && (
        <AddPropertyModal
          // One mounted wizard per target: switching between a property and a
          // fresh one always re-derives its form instead of reusing the
          // previous target's state.
          key={form.property?.id ?? 'new'}
          property={form.property}
          onClose={() => setForm(null)}
          onSave={() => {
            setForm(null);
            setNotice(
              form.property
                ? 'تم حفظ التعديلات وإعادة الإرسال للمراجعة'
                : 'تم إرسال العقار للمراجعة',
            );
            // The backend is the source of truth: reload instead of splicing a
            // client-built record into the list.
            refetch();
          }}
        />
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
